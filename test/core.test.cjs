const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { Git, parseStatus, diffSides, safeFile } = require('../dist/git');
const { discoverRoots, matchesPattern, changedFileCount } = require('../dist/discovery');

const { scanWorktrees, within } = require('../dist/worktrees');
// 原有目录场景只断言该目录内结果；关联的外部 worktree 在专门用例中验证。
async function scanFeatures(roots, excluded, client, issues = []) {
  const features = await scanWorktrees({ folders: [], roots, excluded }, client, issues);
  return features.filter(feature => roots.some(root => within(root, feature.directory)));
}

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
}
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-view-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  git(source, 'init', '-b', 'main');
  git(source, 'config', 'user.name', 'Test');
  git(source, 'config', 'user.email', 'test@example.invalid');
  await fs.writeFile(path.join(source, 'file.txt'), 'base\n');
  await fs.writeFile(path.join(source, 'gone.txt'), 'delete me\n');
  git(source, 'add', '.');
  git(source, 'commit', '-qm', 'fixture');
  const directory = path.join(root, '.worktrees', 'feature-one', 'api');
  git(source, 'worktree', 'add', '-qb', 'feat/one', directory);
  return { root, source, directory };
}

test('NUL 解析保留中文、空格、换行、箭头及重命名源路径', () => {
  const parsed = parseStatus('## feat/demo...origin/feat/demo [ahead 1]\0RM 新 文件\n->.ts\0旧 文件.ts\0?? 未跟踪.ts\0UU 冲突.ts\0');
  assert.equal(parsed.branch, 'feat/demo');
  assert.equal(parsed.changes.length, 4);
  assert.deepEqual(diffSides(parsed.changes[0]), [{ revision: 'HEAD', path: '旧 文件.ts' }, { revision: 'index', path: '新 文件\n->.ts' }]);
  assert.deepEqual(diffSides(parsed.changes[1]), [{ revision: 'index', path: '新 文件\n->.ts' }, { revision: 'working', path: '新 文件\n->.ts' }]);
  assert.equal(parsed.changes[3].group, 'conflict');
  assert.throws(() => diffSides(parsed.changes[3]));
});

test('真实 worktree：暂存和未暂存分离，快照准确且索引不被改写', async t => {
  const { root, source, directory } = await fixture(t);
  const client = new Git();
  const file = path.join(directory, 'file.txt');
  await fs.writeFile(file, 'staged\n');
  git(directory, 'add', 'file.txt');
  await fs.writeFile(file, 'working\n');
  await fs.unlink(path.join(directory, 'gone.txt'));
  await fs.writeFile(path.join(directory, '新 文件\n.txt'), 'new\n');
  const metadata = git(directory, 'rev-parse', '--absolute-git-dir').trim();
  const beforeIndex = await fs.readFile(path.join(metadata, 'index'));
  const beforeHead = git(directory, 'rev-parse', 'HEAD');
  const features = await scanFeatures([path.join(root, '.worktrees')], [], client);
  assert.equal(features.length, 1);
  const repo = features[0].repositories[0];
  assert.equal(repo.branch, 'feat/one');
  assert.equal(changedFileCount(repo), 3);
  const staged = repo.changes.find(c => c.path === 'file.txt' && c.group === 'staged');
  const working = repo.changes.find(c => c.path === 'file.txt' && c.group === 'working');
  assert.ok(staged && working);
  const left = await client.blobId(directory, diffSides(staged)[0]);
  const right = await client.blobId(directory, diffSides(staged)[1]);
  assert.equal((await client.run(directory, ['cat-file', 'blob', left])).toString(), 'base\n');
  assert.equal((await client.run(directory, ['cat-file', 'blob', right])).toString(), 'staged\n');
  assert.equal(await client.blobId(directory, diffSides(working)[0]), right);
  assert.equal(diffSides(repo.changes.find(c => c.path === 'gone.txt'))[1].revision, 'empty');
  assert.ok(repo.changes.some(c => c.path === '新 文件\n.txt' && c.group === 'untracked'));
  assert.deepEqual(await fs.readFile(path.join(metadata, 'index')), beforeIndex);
  assert.equal(git(directory, 'rev-parse', 'HEAD'), beforeHead);
  assert.equal(await fs.readFile(path.join(source, 'file.txt'), 'utf8'), 'base\n');
});

test('跨仓聚合、集成目录排除、新增和删除功能、失效仓库单独报错', async t => {
  const { root, source, directory } = await fixture(t);
  const parent = path.join(root, '.worktrees');
  git(source, 'worktree', 'add', '-qb', 'feat/two', path.join(parent, 'feature-one', 'admin'));
  git(source, 'worktree', 'add', '-qb', 'dev', path.join(parent, 'feature-dev', 'api'));
  await fs.mkdir(path.join(parent, 'feature-broken', 'api'), { recursive: true });
  await fs.writeFile(path.join(parent, 'feature-broken', 'api', '.git'), 'gitdir: /does-not-exist\n');
  await fs.mkdir(path.join(parent, 'not-a-feature', 'notes'), { recursive: true });
  await fs.symlink(path.dirname(directory), path.join(parent, 'symlink-feature'));
  const client = new Git();
  let features = await scanFeatures([parent], ['*-dev'], client);
  assert.deepEqual(features.map(f => f.name), ['feature-broken', 'feature-one']);
  assert.equal(features[1].repositories.length, 2);
  assert.ok(features[0].repositories[0].error);
  assert.equal(features[1].repositories[0].error, undefined);
  git(source, 'worktree', 'add', '-qb', 'feat/new', path.join(parent, 'feature-new', 'api'));
  features = await scanFeatures([parent], ['*-dev'], client);
  assert.ok(features.some(f => f.name === 'feature-new'));
  git(source, 'worktree', 'remove', path.join(parent, 'feature-new', 'api'));
  features = await scanFeatures([parent], ['*-dev'], client);
  assert.ok(!features.some(f => f.name === 'feature-new'));
});

test('自动定位根目录：项目根、worktree 内、多个仓库去重、显式配置', async t => {
  const { root, directory } = await fixture(t);
  const parent = path.join(root, '.worktrees');
  assert.deepEqual(await discoverRoots([root, directory, parent]), [await fs.realpath(parent)]);
  assert.deepEqual(await discoverRoots([root], '.worktrees'), [await fs.realpath(parent)]);
  const issues = [];
  assert.deepEqual(await discoverRoots([root], 'missing', issues), []);
  assert.match(issues[0].message, /不存在/);
  assert.equal(matchesPattern('feature-dev', '*-dev'), true);
  assert.equal(matchesPattern('feature+one', 'feature+one'), true);
  assert.equal(matchesPattern('featureXone', 'feature.one'), false);
  assert.throws(() => safeFile(directory, '../escape'));
  assert.throws(() => safeFile(directory, '/etc/passwd'));
});

test('未提交初始仓库的新增文件可以从空白比较；暂存删除和重命名正确', async t => {
  const { directory } = await fixture(t);
  git(directory, 'mv', 'file.txt', '重命名 文件.txt');
  git(directory, 'rm', '-q', 'gone.txt');
  const changes = (await new Git().status(directory)).changes;
  const renamed = changes.find(c => c.status === 'R');
  assert.equal(renamed.originalPath, 'file.txt');
  assert.equal(renamed.path, '重命名 文件.txt');
  const deleted = changes.find(c => c.status === 'D');
  assert.deepEqual(diffSides(deleted), [{ revision: 'HEAD', path: 'gone.txt' }, { revision: 'empty', path: 'gone.txt' }]);
  assert.deepEqual(diffSides(parseStatus('## No commits yet on main\0A  new.txt\0').changes[0]), [{ revision: 'empty', path: 'new.txt' }, { revision: 'index', path: 'new.txt' }]);
});

test('真实合并冲突独立列出，不误认为暂存成功', async t => {
  const { source, directory } = await fixture(t);
  await fs.writeFile(path.join(source, 'file.txt'), 'main change\n');
  git(source, 'commit', '-qam', 'main change');
  await fs.writeFile(path.join(directory, 'file.txt'), 'feature change\n');
  git(directory, 'commit', '-qam', 'feature change');
  assert.throws(() => git(directory, 'merge', 'main'));
  const status = await new Git().status(directory);
  assert.deepEqual(status.changes, [{ group: 'conflict', status: 'UU', path: 'file.txt' }]);
});

test('单仓库布局与跨仓布局共存，直接 worktree 不扫描内部嵌套仓库', async t => {
  const { root, source } = await fixture(t);
  const parent = path.join(root, '.worktrees');
  const direct = path.join(parent, 'direct-feature');
  git(source, 'worktree', 'add', '-qb', 'feat/direct', direct);
  await fs.writeFile(path.join(direct, 'file.txt'), 'direct change\n');
  const nested = path.join(direct, 'nested-repo');
  await fs.mkdir(nested);
  git(nested, 'init', '-b', 'main');
  const features = await scanFeatures([parent], [], new Git());
  assert.deepEqual(features.map(f => f.name), ['direct-feature', 'feature-one']);
  const feature = features[0];
  assert.equal(feature.repositories.length, 1);
  assert.equal(feature.repositories[0].name, 'source');
  assert.equal(feature.repositories[0].directory, direct);
  assert.equal(feature.repositories[0].branch, 'feat/direct');
  assert.ok(feature.repositories[0].changes.some(c => c.path === 'file.txt'));
  assert.deepEqual(await discoverRoots([direct]), [await fs.realpath(parent)]);
  assert.equal((await scanFeatures([parent], ['direct-*'], new Git())).length, 1);
});

test('项目自身 .worktrees：主目录和分支目录均自动发现，支持 .git 目录和失效 worktree', async t => {
  const { source } = await fixture(t);
  const parent = path.join(source, '.worktrees');
  const direct = path.join(parent, 'feature-a');
  git(source, 'worktree', 'add', '-qb', 'feat/a', direct);
  const standalone = path.join(parent, 'standalone');
  await fs.mkdir(standalone);
  git(standalone, 'init', '-b', 'main');
  await fs.writeFile(path.join(standalone, 'new.txt'), 'new\n');
  const broken = path.join(parent, 'broken');
  await fs.mkdir(broken);
  await fs.writeFile(path.join(broken, '.git'), 'gitdir: /does-not-exist\n');
  assert.deepEqual(await discoverRoots([source, direct]), [await fs.realpath(parent)]);
  const features = await scanFeatures([parent], [], new Git());
  assert.equal(features.length, 2);
  assert.ok(features.find(f => f.name === 'broken').repositories[0].error);
  const repo = features.find(f => f.name === 'standalone');
  assert.equal(repo, undefined, '普通仓库只作发现入口');
});

test('多根工作区部分失效仍发现和刷新正常仓库，恢复后错误消失', async t => {
  const { root, directory } = await fixture(t);
  const other = path.join(root, 'other');
  await fs.mkdir(other);
  const issues = [];
  const roots = await discoverRoots([other, root], '.worktrees', issues);
  assert.deepEqual(roots, [await fs.realpath(path.join(root, '.worktrees'))]);
  assert.equal(issues.length, 1);
  const missing = path.join(other, '.worktrees');
  const scanIssues = [];
  await fs.writeFile(path.join(directory, 'file.txt'), 'fresh\n');
  const features = await scanFeatures([missing, ...roots], [], new Git(), scanIssues);
  assert.equal(scanIssues.length, 1);
  assert.equal(features.length, 1);
  assert.equal(features[0].repositories[0].changes[0].path, 'file.txt');
  await fs.mkdir(missing);
  const recovered = [];
  await scanFeatures(await discoverRoots([other, root], '.worktrees', recovered), [], new Git(), recovered);
  assert.deepEqual(recovered, []);
  const absoluteIssues = [];
  assert.deepEqual(await discoverRoots([other, root], path.join(root, 'missing'), absoluteIssues), []);
  assert.equal(absoluteIssues.length, 1, '绝对路径错误不重复报告');
});

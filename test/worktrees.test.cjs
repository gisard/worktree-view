const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { Git } = require('../dist/git');
const { scanWorktrees, parseWorktrees, groupRepositories } = require('../dist/worktrees');
function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
}
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-view-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'api');
  await fs.mkdir(source);
  git(source, 'init', '-b', 'main');
  git(source, 'config', 'user.name', 'Test');
  git(source, 'config', 'user.email', 'test@example.invalid');
  await fs.writeFile(path.join(source, 'file.txt'), 'base\n');
  git(source, 'add', '.');
  git(source, 'commit', '-qm', 'fixture');
  return { root, source };
}
const repos = features => features.flatMap(feature => feature.repositories);

test('登记解析保留特殊路径、锁定原因、detached 和 bare 状态', () => {
  const entries = parseWorktrees('worktree /a b\n中文\0HEAD abc\0detached\0locked reason\nline\0\0worktree /bare\0bare\0\0worktree /gone\0branch refs/heads/feat/foo\0prunable missing\0\0');
  assert.equal(entries[0].directory, '/a b\n中文');
  assert.equal(entries[0].branch, 'detached HEAD');
  assert.equal(entries[0].locked, 'reason\nline');
  assert.equal(entries[1].bare, true);
  assert.equal(entries[2].branch, 'feat/foo');
  assert.equal(entries[2].prunable, 'missing');
});

test('主仓、内部目录、单独 worktree 均发现外部位置；同仓仅枚举一次', async t => {
  const { root, source } = await fixture(t);
  const external = path.join(root, 'outside location', '中文\nbranch');
  git(source, 'worktree', 'add', '-qb', 'feat/external', external);
  await fs.mkdir(path.join(external, 'src'));
  await fs.writeFile(path.join(external, 'file.txt'), 'changed\n');
  for (const folder of [source, external, path.join(external, 'src')]) {
    const issues = [];
    const features = await scanWorktrees({ folders: [folder], roots: [], excluded: [] }, new Git(), issues);
    assert.equal(repos(features).length, 1);
    assert.equal(repos(features).find(r => r.directory === external).changes.length, 1);
    assert.deepEqual(issues, []);
  }
  let enumerations = 0;
  const client = new Git();
  const run = client.run.bind(client);
  client.run = (directory, args) => { if (args[0] === 'worktree') enumerations++; return run(directory, args); };
  const features = await scanWorktrees({ folders: [source, external], roots: [], knownRepositories: [source], excluded: [] }, client);
  assert.equal(enumerations, 1);
  assert.equal(repos(features).length, 1);
});

test('嵌套分支、跨仓布局、主工作区、同名分支隔离与手动归组', async t => {
  const { root, source } = await fixture(t);
  const trees = path.join(root, '.worktrees');
  const nested = path.join(trees, 'feat', 'login');
  git(source, 'worktree', 'add', '-qb', 'feat/login', nested);
  const grouped = path.join(trees, 'task', 'api');
  git(source, 'worktree', 'add', '-qb', 'feat/task', grouped);
  const discovered = [];
  const features = await scanWorktrees({ folders: [root], roots: [trees], excluded: [], onDiscovered: features => discovered.push(repos(features).every(r => r.loading)) }, new Git());
  assert.ok(features.find(f => f.name === 'feat/login'));
  assert.ok(features.find(f => f.name === 'task'));
  assert.deepEqual(discovered, [true]);
  assert.ok(repos(features).every(r => !r.loading));
  const entries = repos(features);
  const sameBranch = { ...entries[0], directory: path.join(root, 'unrelated'), branch: entries[0].branch };
  assert.equal(groupRepositories([entries[0], sameBranch], []).length, 2);
  const assignments = Object.fromEntries([entries[0], sameBranch].map(r => [r.directory, '合并审查']));
  const manual = groupRepositories([entries[0], sameBranch], [], assignments);
  assert.equal(manual.length, 1);
  assert.equal(manual[0].name, '合并审查');
  assert.equal(manual[0].repositories.length, 2);
});

test('锁定、失效登记隔离；默认不隐藏 dev/test；排除规则生效', async t => {
  const { root, source } = await fixture(t);
  const gone = path.join(root, 'task-dev');
  const locked = path.join(root, 'task-test');
  git(source, 'worktree', 'add', '-qb', 'feat/gone', gone);
  git(source, 'worktree', 'add', '--detach', locked);
  git(source, 'worktree', 'lock', '--reason', 'keep', locked);
  await fs.rm(gone, { recursive: true });
  const options = { folders: [source], roots: [], excluded: [] };
  const features = await scanWorktrees(options, new Git());
  assert.equal(features.length, 2);
  assert.ok(repos(features).find(r => r.directory === gone).error);
  const live = repos(features).find(r => r.directory === locked);
  assert.ok(live.note.includes('keep'));
  assert.equal(live.error, undefined);
  assert.ok(live.branch.includes('detached'));
  assert.equal((await scanWorktrees({ ...options, excluded: ['*-dev', '*-test'] }, new Git())).length, 0);
});

test('坏根目录不影响其他仓库；符号链接入口去重，破损 .git 保留报错', async t => {
  const { root, source } = await fixture(t);
  const alias = path.join(root, 'alias');
  await fs.symlink(source, alias);
  const trees = path.join(root, '.worktrees');
  const broken = path.join(trees, 'broken');
  await fs.mkdir(broken, { recursive: true });
  await fs.writeFile(path.join(broken, '.git'), 'gitdir: /no-such-worktree-view\n');
  const issues = [];
  const features = await scanWorktrees({ folders: [source, alias], roots: [path.join(root, 'missing'), trees], excluded: [] }, new Git(), issues);
  assert.equal(issues.length, 1);
  assert.equal(repos(features).length, 1);
  assert.ok(repos(features).find(r => r.directory === broken).error);
  assert.equal(repos(features).find(r => r.directory === source), undefined);
});

test('直接打开 bare 仓库也能发现关联工作树，bare 本身不查询工作区状态', async t => {
  const { root, source } = await fixture(t);
  const bare = path.join(root, 'server.git');
  git(root, 'clone', '--bare', source, bare);
  const worktree = path.join(root, 'bare-feature');
  git(bare, 'worktree', 'add', '-qb', 'feat/bare', worktree);
  await fs.writeFile(path.join(worktree, 'file.txt'), 'bare worktree change\n');
  for (const folder of [bare, worktree]) {
    const features = await scanWorktrees({ folders: [folder], roots: [], excluded: [] }, new Git());
    assert.equal(repos(features).length, 1);
    assert.equal(repos(features)[0].directory, worktree);
    assert.equal(repos(features)[0].changes.length, 1);
    assert.equal(repos(features)[0].error, undefined);
  }
});


test('普通仓库及主工作区即使有修改或自定义分组也不展示、不查询状态', async t => {
  const { root, source } = await fixture(t);
  await fs.writeFile(path.join(source, 'file.txt'), 'main dirty\n');
  const trees = path.join(root, '.worktrees');
  const standalone = path.join(trees, 'ordinary-clone');
  await fs.mkdir(standalone, { recursive: true });
  git(standalone, 'init', '-b', 'feat/ordinary');
  await fs.writeFile(path.join(standalone, 'new.txt'), 'dirty\n');
  const client = new Git();
  const queried = [];
  const status = client.status.bind(client);
  client.status = directory => { queried.push(directory); return status(directory); };
  const options = { folders: [root], roots: [trees], knownRepositories: [source, standalone], excluded: [], assignments: { [source]: '旧分组' } };
  assert.deepEqual(await scanWorktrees(options, client), []);
  assert.deepEqual(queried, []);
  const linked = path.join(root, 'external');
  git(source, 'worktree', 'add', '-qb', 'feat/linked', linked);
  const features = await scanWorktrees(options, client);
  assert.deepEqual(repos(features).map(repo => repo.directory), [linked]);
  assert.deepEqual(queried, [linked]);
});

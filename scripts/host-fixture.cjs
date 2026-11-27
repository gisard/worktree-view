const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-view-host-'));
function git(cwd, ...args) { return execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }); }
for (const name of ['api', 'admin']) {
  const source = path.join(root, name);
  fs.mkdirSync(source);
  git(source, 'init', '-b', 'main');
  git(source, 'config', 'user.name', 'Test');
  git(source, 'config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(source, 'file.txt'), 'base\n');
  git(source, 'add', '.');
  git(source, 'commit', '-qm', 'fixture');
  const worktree = path.join(root, '.worktrees', 'demo-feature', name);
  git(source, 'worktree', 'add', '-qb', 'feat/demo', worktree);
  if (name === 'api') {
    fs.writeFileSync(path.join(worktree, 'file.txt'), 'staged\n');
    git(worktree, 'add', '.');
    fs.writeFileSync(path.join(worktree, 'file.txt'), 'working\n');
  }
}
const direct = path.join(root, '.worktrees', 'single-feature');
git(path.join(root, 'api'), 'worktree', 'add', '-qb', 'feat/single', direct);
fs.writeFileSync(path.join(direct, 'file.txt'), 'single working\n');
console.log(root);

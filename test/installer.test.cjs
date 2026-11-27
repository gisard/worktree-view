const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('安装器支持空格路径、准确传递 VSIX、传播安装错误且拒绝缺包和多包', { skip: process.platform === 'win32' }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'worktree installer ')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of ['install.sh', 'install.command']) await fs.copyFile(path.join(__dirname, '../installers', name), path.join(root, name));
  const cli = path.join(root, 'fake code');
  const argsFile = path.join(root, 'args');
  await fs.writeFile(cli, '#!/bin/sh\nprintf "%s\\n" "$@" > "$INSTALLER_TEST_ARGS"\nexit "${INSTALLER_TEST_EXIT:-0}"\n', { mode: 0o755 });
  const env = { ...process.env, WORKTREE_VIEW_CODE: cli, INSTALLER_TEST_ARGS: argsFile };
  const run = (extra = {}) => spawnSync('/bin/sh', [path.join(root, 'install.command')], { env: { ...env, ...extra }, encoding: 'utf8' });
  assert.equal(run().status, 1, '缺少包必须失败');
  await fs.writeFile(path.join(root, '插件 package.vsix'), 'fixture');
  assert.equal(run().status, 0);
  assert.deepEqual((await fs.readFile(argsFile, 'utf8')).trim().split('\n'), ['--install-extension', path.join(root, '插件 package.vsix')]);
  const failed = run({ INSTALLER_TEST_EXIT: '7' });
  assert.equal(failed.status, 1);
  assert.ok(!failed.stdout.includes('安装命令已完成'));
  await fs.writeFile(path.join(root, 'other.vsix'), 'fixture');
  assert.equal(run().status, 1, '多个版本不能随机选择');
});

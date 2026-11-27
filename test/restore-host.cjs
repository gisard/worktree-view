const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { execFileSync } = require('node:child_process');

exports.run = async function () {
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const report = JSON.parse(await fs.readFile(path.join(root, 'host-result.json'), 'utf8'));
  const extension = vscode.extensions.getExtension('local-tools.worktree-review');
  assert.equal(extension.packageJSON.displayName, 'worktree 视图');
  assert.equal(extension.packageJSON.contributes.views.scm[0].name, 'worktree 视图');
  const review = await extension.activate();
  const selected = review.getFeatures().find(feature => feature.name === 'demo-feature').repositories;
  // 在隔离工作区写入与选择器相同的映射，再验证刷新及恢复自动分组命令。
  await review.context.workspaceState.update('groups', Object.fromEntries(selected.map(repository => [repository.directory, '自定义测试组'])));
  await review.refresh();
  assert.equal(review.getFeatures().find(feature => feature.name === '自定义测试组').repositories.length, 2);
  await vscode.commands.executeCommand('worktreeReview.resetGroup', { kind: 'repository', repository: selected[0] });
  assert.equal(review.getFeatures().find(feature => feature.name === '自定义测试组').repositories.length, 1);
  await review.context.workspaceState.update('groups', undefined);
  await review.refresh();
  const repository = path.join(root, '.worktrees', 'demo-feature', 'api');
  await fs.writeFile(path.join(repository, 'file.txt'), 'new index after restart\n');
  execFileSync('git', ['-C', repository, 'add', 'file.txt']);
  const head = vscode.Uri.parse(report.snapshots.head);
  const index = vscode.Uri.parse(report.snapshots.index);
  assert.equal(Buffer.from(await vscode.workspace.fs.readFile(head)).toString(), 'base\n');
  assert.equal(Buffer.from(await vscode.workspace.fs.readFile(index)).toString(), 'staged\n', '重启后仍恢复原索引快照，不跟随新的索引变化');
  await assert.rejects(vscode.workspace.fs.readFile(index.with({ query: JSON.stringify(['/tmp/unknown-repo', 'a'.repeat(40)]) })), '拒绝未登记的快照 URI');
  await vscode.commands.executeCommand('vscode.diff', head, index, '恢复快照');
  assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputTextDiff);
  await fs.writeFile(path.join(root, 'restore-result.json'), JSON.stringify({ passed: true, renamed: true, customGroupReset: true, persistedAcrossProcesses: true, originalIndexPreserved: true, unknownUriRejected: true }, null, 2));
};

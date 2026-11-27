const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { execFileSync } = require('node:child_process');

exports.run = async function () {
  const before = vscode.workspace.workspaceFolders.map(folder => folder.uri.toString());
  const extension = vscode.extensions.getExtension('local-tools.worktree-view');
  assert.ok(extension);
  const review = await extension.activate();
  assert.ok(extension.packageJSON.contributes.commands.some(command => command.command === 'worktreeView.openView'));
  await vscode.commands.executeCommand('worktreeView.openView');
  await review.refresh();
  const features = review.getFeatures();
  assert.deepEqual(features.map(feature => feature.name).sort(), ['demo-feature', 'single-feature'], '只展示关联 worktree，不混入主工作区');
  const feature = features.find(f => f.name === 'demo-feature');
  assert.ok(feature, '自动发现功能');
  assert.equal(feature.repositories.length, 2, '跨仓聚合');
  const single = features.find(f => f.name === 'single-feature');
  assert.ok(single, '自动发现单仓库布局');
  assert.equal(single.repositories.length, 1);
  assert.equal(single.repositories[0].name, 'api');
  const featureNode = { kind: 'feature', feature: single };
  const repositoryNode = review.getChildren(featureNode)[0];
  assert.equal(review.getTreeItem(featureNode).collapsibleState, vscode.TreeItemCollapsibleState.Collapsed, '新功能默认折叠');
  assert.notEqual(review.getTreeItem(featureNode).id, review.getTreeItem(repositoryNode).id, '同路径父子节点 ID 必须唯一');
  await review.openDiff({ kind: 'file', repository: single.repositories[0], change: single.repositories[0].changes[0] });
  const singleDiff = vscode.window.tabGroups.activeTabGroup.activeTab.input;
  assert.ok(singleDiff instanceof vscode.TabInputTextDiff);
  assert.equal((await vscode.workspace.openTextDocument(singleDiff.original)).getText(), 'base\n');
  assert.equal((await vscode.workspace.openTextDocument(singleDiff.modified)).getText(), 'single working\n');
  const repository = feature.repositories.find(r => r.name === 'api');
  assert.ok(!repository.error, repository.error);
  const staged = repository.changes.find(c => c.group === 'staged' && c.path === 'file.txt');
  assert.ok(staged);
  const styled = review.getTreeItem({ kind: 'file', repository, change: staged });
  assert.equal(styled.iconPath.id, vscode.ThemeIcon.File.id);
  assert.equal(styled.description, undefined, '根目录文件不重复显示状态文本');
  const { ChangeDecorations, changeUri } = require(path.join(extension.extensionPath, 'dist/decorations'));
  const decorations = new ChangeDecorations();
  assert.equal(decorations.provideFileDecoration(styled.resourceUri).badge, 'M');
  assert.equal(decorations.provideFileDecoration(styled.resourceUri).color.id, 'gitDecoration.modifiedResourceForeground');
  assert.equal(decorations.provideFileDecoration(vscode.Uri.file(path.join(repository.directory, 'file.txt'))), undefined);
  const deleted = changeUri(repository.directory, { ...staged, group: 'working', status: 'D' });
  assert.notEqual(deleted.toString(), styled.resourceUri.toString());
  assert.equal(decorations.provideFileDecoration(deleted).badge, 'D');

  await review.openDiff({ kind: 'file', repository, change: staged });
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  assert.ok(tab.input instanceof vscode.TabInputTextDiff);
  assert.equal((await vscode.workspace.openTextDocument(tab.input.original)).getText(), 'base\n');
  assert.equal((await vscode.workspace.openTextDocument(tab.input.modified)).getText(), 'staged\n');
  const savedSnapshots = { head: tab.input.original.toString(), index: tab.input.modified.toString() };
  const working = repository.changes.find(c => c.group === 'working' && c.path === 'file.txt');
  await review.openDiff({ kind: 'file', repository, change: working });
  const second = vscode.window.tabGroups.activeTabGroup.activeTab.input;
  assert.equal((await vscode.workspace.openTextDocument(second.original)).getText(), 'staged\n');
  assert.equal((await vscode.workspace.openTextDocument(second.modified)).getText(), 'working\n');
  const doc = await vscode.workspace.openTextDocument(second.modified);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, new vscode.Position(0, 0), 'unsaved\n');
  await vscode.workspace.applyEdit(edit);
  await review.refresh();
  assert.equal(doc.isDirty, true, '刷新不得保存或丢弃未保存编辑');
  assert.ok(doc.getText().startsWith('unsaved\n'));
  assert.equal(await fs.readFile(doc.uri.fsPath, 'utf8'), 'working\n');
  // 测试窗口只含临时夹具，撤销测试自己产生的编辑。
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('undo');
  assert.deepEqual(vscode.workspace.workspaceFolders.map(folder => folder.uri.toString()), before);
  assert.equal(review.getChildren()[0].kind, 'feature');
  const bulkNode = { kind: 'feature', feature };
  const repoNode = { kind: 'repository', repository };
  const groupNode = { kind: 'group', repository, group: 'staged' };
  await review.rememberExpansion(bulkNode, true);
  await review.rememberExpansion(repoNode, false);
  await review.rememberExpansion(groupNode, false);
  let loadingUpdates = 0;
  const treeListener = review.onDidChangeTreeData(() => {
    if (!review.loading) return;
    loadingUpdates++;
    const current = review.getFeatures().find(f => f.name === 'demo-feature').repositories.find(r => r.name === 'api');
    assert.ok(review.getChildren({ kind: 'repository', repository: current }).some(n => n.kind === 'group'), '刷新期间不能用加载占位符替换已有分组');
  });
  await vscode.commands.executeCommand('worktreeView.refresh');
  treeListener.dispose();
  assert.ok(loadingUpdates > 0);
  const refreshedFeature = review.getFeatures().find(f => f.name === 'demo-feature');
  const refreshedRepo = refreshedFeature.repositories.find(r => r.name === 'api');
  assert.equal(review.getTreeItem({ kind: 'feature', feature: refreshedFeature }).collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
  assert.equal(review.getTreeItem({ kind: 'repository', repository: refreshedRepo }).collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  assert.equal(review.getTreeItem({ kind: 'group', repository: refreshedRepo, group: 'staged' }).collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  assert.equal(review.context.workspaceState.get('expansion')[refreshedRepo.directory], false, '折叠状态写入工作区存储');
  // 关闭轮询及 Git 状态监听，直接验证文件系统事件驱动的 worktree 增删。
  clearInterval(review.interval);
  review.gitListeners.forEach(listener => listener.dispose());
  const fixture = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const automatic = path.join(fixture, '.worktrees', 'automatic-refresh');
  const source = path.join(fixture, 'api');
  async function waitForFeature(present) {
    const deadline = Date.now() + 10000;
    while (review.getFeatures().some(feature => feature.name === 'automatic-refresh') !== present) {
      assert.ok(Date.now() < deadline, 'worktree 增删应自动刷新，不依赖轮询或手动刷新');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  execFileSync('git', ['-C', source, 'worktree', 'add', '-qb', 'feat/automatic-refresh', automatic]);
  await waitForFeature(true);
  execFileSync('git', ['-C', source, 'worktree', 'remove', automatic]);
  await waitForFeature(false);
  const report = { passed: true, features: features.map(f => ({ name: f.name, repos: f.repositories.map(r => r.name) })), singleLayoutDiff: true, workspaceUnchanged: true, stagedDiff: true, workingDiff: true, unsavedPreserved: true };
  report.automaticWorktreeCreateDelete = true;
  report.expansionPreserved = true;
  report.snapshots = savedSnapshots;
  await fs.writeFile(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'host-result.json'), JSON.stringify(report, null, 2));
  console.log('WORKTREE_VIEW_HOST_PASS', JSON.stringify(report));
  const { WorktreeView } = require(path.join(extension.extensionPath, 'dist/extension'));
  const savedContext = review.context;
  review.dispose();
  const restoredView = new WorktreeView(savedContext);
  try {
    await restoredView.initialize();
    const restoredFeature = restoredView.getFeatures().find(f => f.name === 'demo-feature');
    const restoredRepo = restoredFeature.repositories.find(r => r.name === 'api');
    assert.equal(restoredView.getTreeItem({ kind: 'feature', feature: restoredFeature }).collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    assert.equal(restoredView.getTreeItem({ kind: 'repository', repository: restoredRepo }).collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  } finally { restoredView.dispose(); }
};

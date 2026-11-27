import * as vscode from 'vscode';
import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { changedFileCount, discoverRoots, Feature, Repository, RootIssue } from './discovery';
import { Change, ChangeGroup, diffSides, Git, safeFile } from './git';
import { Snapshots, snapshotScheme } from './snapshots';
import { GroupAssignments, scanWorktrees, within } from './worktrees';
import { ChangeDecorations, changeUri } from './decorations';

type Node =
  | { kind: 'feature'; feature: Feature }
  | { kind: 'repository'; repository: Repository }
  | { kind: 'group'; repository: Repository; group: ChangeGroup }
  | { kind: 'file'; repository: Repository; change: Change }
  | { kind: 'info'; label: string; error?: boolean };

const groupLabels: Record<ChangeGroup, string> = {
  conflict: '冲突', staged: '已暂存', working: '未暂存', untracked: '未跟踪',
};
const groups: ChangeGroup[] = ['conflict', 'staged', 'working', 'untracked'];

interface GitRepository {
  rootUri: vscode.Uri;
  state: { onDidChange: vscode.Event<void> };
}
interface GitAPI {
  git: { path: string };
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}
interface GitExtension { getAPI(version: 1): GitAPI }

export class WorktreeView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly git = new Git();
  private readonly snapshots: Snapshots;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly gitListeners = new Map<GitRepository, vscode.Disposable>();
  private readonly view: vscode.TreeView<Node>;
  private features: Feature[] = [];
  private roots: string[] = [];
  private filter = '';
  private onlyChanged: boolean;
  private showIntegration: boolean;
  private error = '';
  private loading = false;
  private disposed = false;
  private pending = false;
  private running?: Promise<void>;
  private debounce?: NodeJS.Timeout;
  private interval?: NodeJS.Timeout;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.snapshots = new Snapshots(this.git, context.storageUri ?? context.globalStorageUri);
    this.onlyChanged = context.workspaceState.get('onlyChanged', false);
    this.showIntegration = context.workspaceState.get('showIntegration', false);
    this.view = vscode.window.createTreeView('worktreeView.changes', { treeDataProvider: this, showCollapseAll: true });
    this.disposables.push(this.view, this.changed, this.snapshots,
      vscode.window.registerFileDecorationProvider(new ChangeDecorations()),
      vscode.workspace.registerFileSystemProvider(snapshotScheme, this.snapshots, { isReadonly: true, isCaseSensitive: true }),
      this.view.onDidChangeVisibility(event => { if (event.visible) void this.refresh(); }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.schedule()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('worktreeView')) { this.startInterval(); this.schedule(); }
      }),
      vscode.workspace.onDidSaveTextDocument(document => {
        if (this.contains(document.uri.fsPath)) this.schedule();
      }),
    );
    this.command('openView', () => vscode.commands.executeCommand('worktreeView.changes.focus'));
    this.command('refresh', () => this.refresh());
    this.command('chooseRoot', () => this.chooseRoot());
    this.command('autoRoot', async () => {
      await context.workspaceState.update('root', undefined);
      await this.refresh();
      if (vscode.workspace.getConfiguration('worktreeView').get<string>('root')) {
        void vscode.window.showInformationMessage('目录设置 worktreeView.root 仍然生效；清空该设置即可自动发现。');
      }
    });
    this.command('filter', async () => {
      const value = await vscode.window.showInputBox({ title: '筛选功能名称', value: this.filter, prompt: '输入功能名称的一部分，留空显示全部' });
      if (value === undefined) return;
      this.filter = value.trim();
      this.updateView();
    });
    this.command('onlyChanged', async () => {
      this.onlyChanged = !this.onlyChanged;
      await context.workspaceState.update('onlyChanged', this.onlyChanged);
      this.updateView();
    });
    this.command('showIntegration', async () => {
      this.showIntegration = !this.showIntegration;
      await context.workspaceState.update('showIntegration', this.showIntegration);
      await this.refresh();
    });
    this.command('assignGroup', () => this.assignGroup());
    this.command('resetGroup', node => this.resetGroup(node));
    this.command('openDiff', node => this.openDiff(node));
    this.command('openFile', node => this.openFile(node));
    this.startInterval();
  }

  private command(name: string, action: (node?: Node) => unknown): void {
    this.disposables.push(vscode.commands.registerCommand(`worktreeView.${name}`, async (node?: Node) => {
      try { return await action(node); }
      catch (error) { void vscode.window.showErrorMessage(`worktree 视图：${error instanceof Error ? error.message : String(error)}`); }
    }));
  }

  async initialize(): Promise<void> {
    try {
      const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
      if (extension) {
        const api = (await extension.activate()).getAPI(1);
        if (this.disposed) return;
        this.git.executable = api.git.path;
        const listen = (repository: GitRepository) => {
          if (this.gitListeners.has(repository)) return;
          this.gitListeners.set(repository, repository.state.onDidChange(() => {
            if (this.view.visible && this.contains(repository.rootUri.fsPath)) this.schedule();
          }));
        };
        api.repositories.forEach(listen);
        this.disposables.push(api.onDidOpenRepository(repository => { listen(repository); this.schedule(); }),
          api.onDidCloseRepository(repository => { this.gitListeners.get(repository)?.dispose(); this.gitListeners.delete(repository); }));
      }
    } catch {
      // 内置 Git 被禁用或 API 不可用时，仍可通过只读 CLI 扫描。
    }
    if (!this.disposed) await this.refresh();
    if (!this.disposed && this.context.extensionMode === vscode.ExtensionMode.Production && !this.context.globalState.get('welcomeShown')) {
      await this.context.globalState.update('welcomeShown', true);
      void vscode.window.showInformationMessage('worktree 视图已就绪，打开项目后会自动发现关联工作树。', '打开视图').then(choice => {
        if (choice && !this.disposed) void vscode.commands.executeCommand('worktreeView.changes.focus');
      });
    }
  }

  private contains(file: string): boolean {
    return this.roots.some(root => within(root, file)) || this.features.some(feature => feature.repositories.some(repository => within(repository.directory, file)));
  }

  private startInterval(): void {
    clearInterval(this.interval);
    const seconds = vscode.workspace.getConfiguration('worktreeView').get<number>('refreshInterval', 15);
    this.interval = setInterval(() => { if (this.view.visible) void this.refresh(); }, Math.max(5, Math.min(300, seconds)) * 1000);
  }

  private schedule(): void {
    if (this.disposed) return;
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { void this.refresh(); }, 700);
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.running) { this.pending = true; return this.running; }
    this.running = this.scan().finally(() => {
      this.running = undefined;
      if (this.pending && !this.disposed) { this.pending = false; this.schedule(); }
    });
    return this.running;
  }

  private async scan(): Promise<void> {
    this.loading = true;
    this.updateView();
    try {
      const config = vscode.workspace.getConfiguration('worktreeView');
      const root = this.context.workspaceState.get<string>('root') || config.get<string>('root');
      const folders = (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath);
      const issues: RootIssue[] = [];
      const roots = await discoverRoots(folders, root, issues);
      const excluded = this.showIntegration ? [] : config.get<string[]>('excludedFeatures', []);
      const features = await scanWorktrees({
        folders: root ? [] : folders, roots, excluded,
        knownRepositories: root ? [] : [...this.gitListeners.keys()].map(repository => repository.rootUri.fsPath),
        assignments: this.context.workspaceState.get<GroupAssignments>('groups', {}),
        onDiscovered: discovered => {
          if (this.disposed) return;
          this.roots = roots;
          this.features = discovered;
          this.updateView();
        },
      }, this.git, issues);
      if (this.disposed) return;
      this.roots = roots;
      this.features = features;
      this.error = issues.length ? `部分目录读取失败，其余结果已更新：\n${issues.map(issue => `${issue.directory}：${issue.message}`).join('\n')}` : '';
    } catch (error) {
      this.error = `刷新失败（保留上次结果）：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.loading = false;
      if (!this.disposed) this.updateView();
    }
  }

  private updateView(): void {
    const labels: string[] = [];
    if (this.filter) labels.push(`名称：${this.filter}`);
    if (this.onlyChanged) labels.push('只看改动');
    if (this.showIntegration) labels.push('含排除项');
    if (this.loading) labels.push('刷新中…');
    this.view.description = labels.join(' · ');
    this.view.message = this.error || (!this.features.length && !this.loading ? '未发现仓库或结果已被过滤；可打开关联仓库，或通过菜单选择 worktree 父目录。' : undefined);
    this.changed.fire();
  }

  private async chooseRoot(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: '选择包含各功能目录的父目录（例如 .worktrees）' });
    if (!selected?.[0]) return;
    if (selected[0].scheme !== 'file') throw new Error('仅支持扩展运行环境中的文件系统目录');
    await this.context.workspaceState.update('root', selected[0].fsPath);
    await this.refresh();
  }

  private async assignGroup(): Promise<void> {
    const repositories = this.features.flatMap(feature => feature.repositories);
    const selected = await vscode.window.showQuickPick(repositories.map(repository => ({
      label: repository.name, description: repository.branch, detail: repository.directory, repository,
    })), { canPickMany: true, title: '选择要归入同一功能组的 worktree', matchOnDescription: true, matchOnDetail: true });
    if (!selected?.length) return;
    const name = await vscode.window.showInputBox({ title: '功能组名称', prompt: '填写已有名称可加入该自定义组；仅影响当前工作区的插件视图', validateInput: value => value.trim() ? undefined : '请输入名称' });
    if (!name?.trim()) return;
    const assignments = { ...this.context.workspaceState.get<GroupAssignments>('groups', {}) };
    for (const item of selected) assignments[item.repository.directory] = name.trim();
    await this.context.workspaceState.update('groups', assignments);
    await this.refresh();
  }

  private async resetGroup(node?: Node): Promise<void> {
    if (node?.kind !== 'repository') return;
    const assignments = { ...this.context.workspaceState.get<GroupAssignments>('groups', {}) };
    delete assignments[node.repository.directory];
    await this.context.workspaceState.update('groups', assignments);
    await this.refresh();
  }

  getFeatures(): readonly Feature[] { return this.features; }

  getChildren(node?: Node): Node[] {
    if (!node) {
      const nodes: Node[] = this.features.filter(feature => feature.name.toLocaleLowerCase().includes(this.filter.toLocaleLowerCase()))
        .filter(feature => !this.onlyChanged || feature.error || feature.repositories.some(repository => repository.error || repository.loading || repository.changes.length))
        .map(feature => ({ kind: 'feature', feature }));
      if (nodes.length) return nodes;
      return [{ kind: 'info', label: this.loading ? '正在读取 Git 状态…' : this.filter || this.onlyChanged ? '没有符合筛选的功能' : '暂无功能仓库' }];
    }
    if (node.kind === 'feature') {
      const children: Node[] = node.feature.repositories.map(repository => ({ kind: 'repository', repository }));
      if (node.feature.error) children.unshift({ kind: 'info', label: node.feature.error, error: true });
      return children;
    }
    if (node.kind === 'repository') {
      if (node.repository.loading) return [{ kind: 'info', label: '正在读取 Git 状态…' }];
      if (node.repository.error) return [{ kind: 'info', label: node.repository.error, error: true }];
      const children: Node[] = groups.filter(group => node.repository.changes.some(change => change.group === group)).map(group => ({ kind: 'group', repository: node.repository, group }));
      return children.length ? children : [{ kind: 'info', label: '工作区干净' }];
    }
    if (node.kind === 'group') return node.repository.changes.filter(change => change.group === node.group)
      .sort((a, b) => a.path.localeCompare(b.path)).map(change => ({ kind: 'file', repository: node.repository, change }));
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const expanded = vscode.TreeItemCollapsibleState.Expanded;
    if (node.kind === 'info') {
      const item = new vscode.TreeItem(node.label);
      item.iconPath = new vscode.ThemeIcon(node.error ? 'warning' : 'info');
      return item;
    }
    if (node.kind === 'feature') {
      const feature = node.feature;
      const item = new vscode.TreeItem(feature.name, expanded);
      item.id = `feature:${feature.directory}`;
      const count = feature.repositories.reduce((total, repository) => total + changedFileCount(repository), 0);
      const errors = feature.error || feature.repositories.some(repository => repository.error);
      item.description = feature.repositories.some(repository => repository.loading) ? '正在读取…' : `${count} 个修改${errors ? ' · 读取异常' : ''}`;
      item.tooltip = feature.directory.startsWith('manual:') ? `自定义功能组：${feature.name}` : feature.directory;
      item.iconPath = new vscode.ThemeIcon(errors ? 'warning' : 'folder-library');
      return item;
    }
    const repository = node.repository;
    if (node.kind === 'repository') {
      const item = new vscode.TreeItem(repository.name, expanded);
      item.id = repository.directory;
      item.description = `${repository.branch || '未知分支'} · ${repository.loading ? '正在读取…' : repository.error ? '读取失败' : changedFileCount(repository) + ' 个修改'}`;
      item.contextValue = 'worktreeRepository';
      item.tooltip = `${repository.directory}\n${repository.error ?? repository.branch}${repository.note ? '\n' + repository.note : ''}`;
      item.iconPath = new vscode.ThemeIcon(repository.error ? 'warning' : 'repo');
      return item;
    }
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(groupLabels[node.group], expanded);
      item.id = `${repository.directory}/${node.group}`;
      item.description = String(repository.changes.filter(change => change.group === node.group).length);
      item.iconPath = new vscode.ThemeIcon(node.group === 'conflict' ? 'warning' : 'files');
      return item;
    }
    const change = node.change;
    const item = new vscode.TreeItem(path.basename(change.path));
    item.id = `${repository.directory}/${change.group}/${change.path}`;
    const parent = path.dirname(change.path);
    item.description = parent === '.' ? undefined : parent;
    item.tooltip = `${change.originalPath ? change.originalPath + ' → ' : ''}${change.path}\n${groupLabels[change.group]}`;
    item.contextValue = 'changeFile';
    item.resourceUri = changeUri(repository.directory, change);
    item.iconPath = vscode.ThemeIcon.File;
    item.command = { command: 'worktreeView.openDiff', title: '查看改动', arguments: [node] };
    return item;
  }

  async openFile(node?: Node): Promise<void> {
    if (node?.kind !== 'file') return;
    const file = safeFile(node.repository.directory, node.change.path);
    const stat = await lstat(file);
    if (stat.isDirectory()) {
      void vscode.window.showInformationMessage('这是子模块或嵌套目录，请在对应仓库中查看改动。');
      return;
    }
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
  }

  async openDiff(node?: Node): Promise<void> {
    if (node?.kind !== 'file') return;
    if (node.change.group === 'conflict') {
      await this.openFile(node);
      void vscode.window.showInformationMessage('冲突文件已打开，保留 Git 冲突状态；本视图不执行解决或暂存。');
      return;
    }
    const sides = diffSides(node.change);
    if (sides[1].revision === 'working') {
      const stat = await lstat(safeFile(node.repository.directory, sides[1].path));
      if (stat.isDirectory() || stat.isSymbolicLink()) {
        void vscode.window.showInformationMessage('子模块或符号链接改动请使用 Git 查看；本视图不把目标内容当作链接本身的 diff。');
        return;
      }
    }
    const [left, right] = await Promise.all(sides.map(side => this.snapshots.uri(node.repository.directory, side)));
    await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(node.change.path)} · ${groupLabels[node.change.group]}`, { preview: true });
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.debounce);
    clearInterval(this.interval);
    this.git.dispose();
    this.gitListeners.forEach(listener => listener.dispose());
    this.gitListeners.clear();
    this.disposables.forEach(disposable => disposable.dispose());
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<WorktreeView> {
  const review = new WorktreeView(context);
  context.subscriptions.push(review);
  await review.initialize();
  return review;
}

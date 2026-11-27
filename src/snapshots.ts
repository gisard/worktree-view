import * as vscode from 'vscode';
import path from 'node:path';
import { Git, Side, safeFile } from './git';

const SCHEME = 'worktree-view';
interface Snapshot { repository: string; oid?: string }

export class Snapshots implements vscode.FileSystemProvider {
  private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changes.event;
  private readonly known = new Map<string, Snapshot>();
  private saving: Promise<void> = Promise.resolve();
  private readonly ready: Promise<void>;
  constructor(private readonly git: Git, private readonly storage: vscode.Uri) {
    this.ready = this.load();
    void this.ready.catch(() => {});
  }

  private async load(): Promise<void> {
    let saved: Record<string, Snapshot>;
    try {
      const content = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.storage, 'snapshots.json'));
      saved = JSON.parse(Buffer.from(content).toString('utf8'));
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return;
      throw error;
    }
    for (const [key, value] of Object.entries(saved)) {
      if (value && typeof value.repository === 'string' && path.isAbsolute(value.repository)
        && (value.oid === undefined || /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.oid))) {
        this.known.set(key, value);
      }
    }
  }

  async uri(repository: string, side: Side): Promise<vscode.Uri> {
    if (side.revision === 'working') return vscode.Uri.file(safeFile(repository, side.path));
    await this.ready;
    const oid = await this.git.blobId(repository, side);
    const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${side.revision}/${path.basename(side.path)}`, query: JSON.stringify([repository, oid ?? 'empty']) });
    this.known.set(uri.toString(), { repository, oid });
    // 串行持久化，保证 diff 打开前已登记，窗口重载后可恢复同一快照。
    const data = Buffer.from(JSON.stringify(Object.fromEntries(this.known)));
    this.saving = this.saving.catch(() => {}).then(async () => {
      await vscode.workspace.fs.createDirectory(this.storage);
      const temporary = vscode.Uri.joinPath(this.storage, 'snapshots.json.tmp');
      await vscode.workspace.fs.writeFile(temporary, data);
      await vscode.workspace.fs.rename(temporary, vscode.Uri.joinPath(this.storage, 'snapshots.json'), { overwrite: true });
    });
    await this.saving;
    return uri;
  }

  private async snapshot(uri: vscode.Uri): Promise<Snapshot> {
    await this.ready;
    const snapshot = this.known.get(uri.toString());
    if (!snapshot) throw vscode.FileSystemError.FileNotFound('快照已失效，请从功能改动视图重新打开');
    return snapshot;
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { repository, oid } = await this.snapshot(uri);
    if (oid && (await this.git.run(repository, ['cat-file', '-t', oid])).toString().trim() !== 'blob') {
      throw vscode.FileSystemError.Unavailable('此对象不是文件快照，可能是子模块；请使用 Git 查看');
    }
    const size = oid ? Number((await this.git.run(repository, ['cat-file', '-s', oid])).toString()) : 0;
    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size, permissions: vscode.FilePermission.Readonly };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { repository, oid } = await this.snapshot(uri);
    if (!oid) return Buffer.alloc(0);
    const stat = await this.stat(uri);
    if (stat.size > 16 * 1024 * 1024) throw vscode.FileSystemError.Unavailable('文件超过 16 MiB，请使用外部工具查看');
    return this.git.run(repository, ['cat-file', 'blob', oid]);
  }

  watch(): vscode.Disposable { return new vscode.Disposable(() => {}); }
  readDirectory(): [string, vscode.FileType][] { throw vscode.FileSystemError.NoPermissions(); }
  createDirectory(): void { throw vscode.FileSystemError.NoPermissions(); }
  writeFile(): void { throw vscode.FileSystemError.NoPermissions(); }
  delete(): void { throw vscode.FileSystemError.NoPermissions(); }
  rename(): void { throw vscode.FileSystemError.NoPermissions(); }
  dispose(): void { this.changes.dispose(); this.known.clear(); }
}

export const snapshotScheme = SCHEME;

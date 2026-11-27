import * as vscode from 'vscode';
import { Change, safeFile } from './git';

const scheme = 'worktree-review-change';
const styles: Record<string, [string, string]> = {
  M: ['已修改', 'modifiedResourceForeground'],
  A: ['已新增', 'addedResourceForeground'],
  D: ['已删除', 'deletedResourceForeground'],
  R: ['已重命名', 'renamedResourceForeground'],
  C: ['已复制', 'addedResourceForeground'],
  T: ['类型改变', 'modifiedResourceForeground'],
  U: ['未跟踪', 'untrackedResourceForeground'],
  '!': ['存在冲突', 'conflictingResourceForeground'],
};

export function changeUri(repository: string, change: Change): vscode.Uri {
  const status = change.group === 'conflict' ? '!' : change.group === 'untracked' ? 'U' : change.status;
  // 独立 URI 避免同一文件的暂存/未暂存状态互相覆盖，也不染色原生资源管理器。
  return vscode.Uri.file(safeFile(repository, change.path)).with({ scheme, query: `${change.group}:${status}` });
}

export class ChangeDecorations implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== scheme) return;
    const status = uri.query.split(':')[1];
    const style = styles[status];
    if (!style) return;
    return new vscode.FileDecoration(status, style[0], new vscode.ThemeColor(`gitDecoration.${style[1]}`));
  }
}

import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Status } from './git';

export interface Repository extends Status {
  name: string;
  directory: string;
  error?: string;
  loading?: boolean;
  note?: string;
}
export interface Feature {
  name: string;
  directory: string;
  repositories: Repository[];
  error?: string;
}
export interface RootIssue { directory: string; message: string }

async function directoryExists(directory: string): Promise<boolean> {
  try { return (await lstat(directory)).isDirectory(); } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
    throw error;
  }
}

export async function discoverRoots(workspaceFolders: string[], configured?: string, issues: RootIssue[] = []): Promise<string[]> {
  const found = new Set<string>();
  const folders = configured && path.isAbsolute(configured) ? [''] : workspaceFolders;
  for (const folder of folders) {
    let candidate = configured ? path.resolve(folder, configured) : folder;
    try {
      if (configured) {
        // 显式配置错误不能静默回退到别的目录。
        if (!(await directoryExists(candidate))) throw new Error('Worktree 父目录不存在或不是目录');
        found.add(await realpath(candidate));
        continue;
      }
      let current = folder;
      while (true) {
        candidate = path.basename(current) === '.worktrees' ? current : path.join(current, '.worktrees');
        if (await directoryExists(candidate)) {
          found.add(await realpath(candidate));
          break;
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
    } catch (error) {
      issues.push({ directory: candidate, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return [...found].sort();
}

export function matchesPattern(name: string, pattern: string): boolean {
  const regex = pattern.split('').map(char => char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')).join('');
  return new RegExp(`^${regex}$`, 'i').test(name);
}

export async function hasGitMetadata(directory: string): Promise<boolean> {
  try {
    const metadata = await lstat(path.join(directory, '.git'));
    return metadata.isFile() || metadata.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function isRepositorySeed(directory: string): Promise<boolean> {
  if (await hasGitMetadata(directory)) return true;
  try {
    const [head, objects, config] = await Promise.all(['HEAD', 'objects', 'config'].map(name => lstat(path.join(directory, name))));
    return head.isFile() && objects.isDirectory() && config.isFile();
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
    throw error;
  }
}

export function changedFileCount(repository: Repository): number {
  return new Set(repository.changes.map(change => change.path)).size;
}

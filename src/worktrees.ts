import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Feature, Repository, RootIssue, isRepositorySeed, matchesPattern } from './discovery';
import { Git } from './git';

export interface WorktreeEntry {
  directory: string;
  branch: string;
  bare?: boolean;
  locked?: string;
  prunable?: string;
}

export function parseWorktrees(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let entry: WorktreeEntry | undefined;
  for (const field of output.split('\0')) {
    if (field.startsWith('worktree ')) {
      entry = { directory: field.slice(9), branch: '' };
      entries.push(entry);
    } else if (entry) {
      if (field.startsWith('branch ')) entry.branch = field.slice(7).replace(/^refs\/heads\//, '');
      else if (field === 'detached') entry.branch = 'detached HEAD';
      else if (field === 'bare') entry.bare = true;
      else if (field === 'locked' || field.startsWith('locked ')) entry.locked = field.slice(7) || '已锁定';
      else if (field === 'prunable' || field.startsWith('prunable ')) entry.prunable = field.slice(9) || '登记已失效';
    }
  }
  return entries;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function canonical(directory: string): Promise<string> {
  try { return await realpath(directory); }
  catch { return path.resolve(directory); }
}
export function within(root: string, directory: string): boolean {
  const relative = path.relative(root, directory);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

// 只递归明确的 worktree 父目录，遇到仓库即停止，避免遍历业务代码。
async function collectRoots(roots: string[], seeds: Set<string>, issues: RootIssue[]): Promise<void> {
  const visited = new Set<string>();
  for (const root of roots) {
    const queue = [{ directory: root, depth: 0 }];
    for (let i = 0; i < queue.length; i++) {
      const { directory, depth } = queue[i];
      const key = await canonical(directory);
      if (visited.has(key)) continue;
      if (visited.size >= 2000) {
        issues.push({ directory: root, message: '目录扫描达到 2000 个上限，请选择更具体的父目录' });
        return;
      }
      visited.add(key);
      try {
        if (await isRepositorySeed(directory)) { seeds.add(key); continue; }
        const children = (await readdir(directory, { withFileTypes: true })).filter(entry =>
          entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', 'vendor'].includes(entry.name));
        if (depth >= 12 && children.length) {
          issues.push({ directory, message: '目录扫描达到 12 层上限，请选择更具体的父目录' });
          continue;
        }
        for (const child of children) queue.push({ directory: path.join(directory, child.name), depth: depth + 1 });
      } catch (error) { issues.push({ directory, message: message(error) }); }
    }
  }
}

async function workspaceSeeds(folders: string[], seeds: Set<string>, issues: RootIssue[]): Promise<void> {
  for (const folder of folders) {
    try {
      let current = folder;
      while (true) {
        if (await isRepositorySeed(current)) { seeds.add(await canonical(current)); break; }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      // 多仓根目录只检查直属仓库；更深的仓库可通过原生 Git 或明确父目录发现。
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const directory = path.join(folder, entry.name);
        if (await isRepositorySeed(directory)) seeds.add(await canonical(directory));
      }
    } catch (error) { issues.push({ directory: folder, message: message(error) }); }
  }
}

export type GroupAssignments = Record<string, string>;

export function groupRepositories(repositories: Repository[], roots: string[], assignments: GroupAssignments = {}): Feature[] {
  const groups = new Map<string, Feature>();
  const orderedRoots = [...roots].sort((a, b) => b.length - a.length);
  for (const repository of repositories) {
    let directory = repository.directory;
    let name = path.basename(directory);
    const assigned = assignments[directory];
    const root = orderedRoots.find(candidate => within(candidate, directory) && candidate !== directory);
    if (assigned) {
      directory = `manual:${assigned}`;
      name = assigned;
    } else if (root) {
      const relative = path.relative(root, directory);
      const parts = relative.split(path.sep);
      const branchPath = parts.join('/') === repository.branch;
      const branchLeaf = parts.at(-1) === repository.branch.split('/').at(-1);
      const repositoryLeaf = parts.at(-1) === repository.name;
      // 分支路径与目录一致时保留完整分支；其余沿用“功能 / 仓库”的目录约定。
      if (parts.length > 1 && !branchPath && (repositoryLeaf || !branchLeaf)) {
        directory = path.dirname(directory);
        name = path.relative(root, directory).split(path.sep).join('/');
      } else name = parts.join('/');
    }
    let feature = groups.get(directory);
    if (!feature) { feature = { name, directory, repositories: [] }; groups.set(directory, feature); }
    feature.repositories.push(repository);
  }
  for (const feature of groups.values()) feature.repositories.sort((a, b) => a.name.localeCompare(b.name) || a.directory.localeCompare(b.directory));
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.directory.localeCompare(b.directory));
}

export interface ScanOptions {
  folders: string[];
  roots: string[];
  knownRepositories?: string[];
  excluded: string[];
  assignments?: GroupAssignments;
  onDiscovered?: (features: Feature[]) => void;
}

export async function scanWorktrees(options: ScanOptions, git: Git, issues: RootIssue[] = []): Promise<Feature[]> {
  const seeds = new Set<string>();
  const roots = new Set(await Promise.all(options.roots.map(canonical)));
  await workspaceSeeds(options.folders, seeds, issues);
  await collectRoots([...roots], seeds, issues);
  for (const directory of options.knownRepositories ?? []) seeds.add(await canonical(directory));
  const commonDirectories = new Set<string>();
  const repositories = new Map<string, Repository>();
  for (const seed of seeds) {
    try {
      const common = await canonical(path.resolve(seed, (await git.run(seed, ['rev-parse', '--git-common-dir'])).toString().trim()));
      if (commonDirectories.has(common)) continue;
      const entries = parseWorktrees((await git.run(seed, ['worktree', 'list', '--porcelain', '-z'])).toString());
      commonDirectories.add(common);
      const name = path.basename(path.basename(common) === '.git' ? path.dirname(common) : entries[0]?.directory ?? common);
      for (const entry of entries) {
        // Git 首条登记是主工作区（或 bare 仓库），只作为发现入口。
        if (entry === entries[0] || entry.bare) continue;
        const directory = await canonical(entry.directory);
        let parent = path.dirname(directory);
        while (parent !== path.dirname(parent)) {
          if (path.basename(parent) === '.worktrees') { roots.add(parent); break; }
          parent = path.dirname(parent);
        }
        repositories.set(directory, {
          name, directory, branch: entry.branch, changes: [], loading: !entry.prunable,
          note: entry.locked ? `已锁定：${entry.locked}` : undefined,
          error: entry.prunable ? `Worktree 登记失效：${entry.prunable}` : undefined,
        });
      }
    } catch (error) {
      if ([...roots].some(root => within(root, seed))) {
        if (!repositories.has(seed)) repositories.set(seed, { name: path.basename(seed), directory: seed, branch: '', changes: [], error: message(error) });
      } else issues.push({ directory: seed, message: message(error) });
    }
  }
  const features = groupRepositories([...repositories.values()], [...roots], options.assignments)
    .filter(feature => !options.excluded.some(pattern => matchesPattern(feature.name, pattern)));
  options.onDiscovered?.(features);
  await Promise.all(features.flatMap(feature => feature.repositories.map(async repository => {
    if (repository.error) return;
    try { Object.assign(repository, await git.status(repository.directory)); }
    catch (error) { repository.error = message(error); }
    finally { repository.loading = false; }
  })));
  return features;
}

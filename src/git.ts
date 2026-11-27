import { ChildProcess, execFile } from 'node:child_process';
import path from 'node:path';

export type ChangeGroup = 'staged' | 'working' | 'untracked' | 'conflict';
export interface Change {
  group: ChangeGroup;
  status: string;
  path: string;
  originalPath?: string;
}
export interface Status {
  branch: string;
  changes: Change[];
}

const conflicts = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

export function parseStatus(output: string): Status {
  const records = output.split('\0');
  const result: Status = { branch: '', changes: [] };
  for (let i = 0; i < records.length; i++) {
    const line = records[i];
    if (!line) continue;
    if (line.startsWith('## ')) {
      result.branch = line.slice(3).split('...')[0]
        .replace(/^No commits yet on /, '').replace(/^Initial commit on /, '')
        .replace(/^HEAD \(no branch\)$/, 'detached HEAD');
      continue;
    }
    if (line.length < 4 || line[2] !== ' ') throw new Error('无法解析 Git 状态');
    const xy = line.slice(0, 2);
    const file = line.slice(3);
    let originalPath: string | undefined;
    if (/[RC]/.test(xy)) {
      originalPath = records[++i];
      if (!originalPath) throw new Error('Git 重命名记录缺少原路径');
    }
    if (xy === '!!') continue;
    if (conflicts.has(xy)) {
      result.changes.push({ group: 'conflict', status: xy, path: file });
      continue;
    }
    if (xy === '??') {
      result.changes.push({ group: 'untracked', status: '?', path: file });
      continue;
    }
    if (xy[0] !== ' ') result.changes.push({ group: 'staged', status: xy[0], path: file, originalPath });
    if (xy[1] !== ' ') result.changes.push({ group: 'working', status: xy[1], path: file, originalPath: /[RC]/.test(xy[1]) ? originalPath : undefined });
  }
  return result;
}

export function safeFile(repository: string, file: string): string {
  const absolute = path.resolve(repository, file);
  const relative = path.relative(repository, absolute);
  if (!relative || path.isAbsolute(file) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('文件不在仓库目录内');
  }
  return absolute;
}

export type Side = { revision: 'HEAD' | 'index' | 'working' | 'empty'; path: string };
export function diffSides(change: Change): [Side, Side] {
  const file = change.path;
  if (change.group === 'conflict') throw new Error('冲突文件应打开工作区内容');
  if (change.group === 'untracked') return [{ revision: 'empty', path: file }, { revision: 'working', path: file }];
  const added = change.status === 'A' || change.status === '?';
  const deleted = change.status === 'D';
  return [
    { revision: added ? 'empty' : change.group === 'staged' ? 'HEAD' : 'index', path: change.originalPath ?? file },
    { revision: deleted ? 'empty' : change.group === 'staged' ? 'index' : 'working', path: file },
  ];
}

export class Git {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly processes = new Set<ChildProcess>();
  private disposed = false;
  constructor(public executable = 'git') {}

  async run(repository: string, args: string[]): Promise<Buffer> {
    if (this.disposed) throw new Error('Git 查询已停止');
    if (this.active >= 4) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try {
      if (this.disposed) throw new Error('Git 查询已停止');
      return await new Promise<Buffer>((resolve, reject) => {
        const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
        // 从 Git 启动的编辑器也必须查询所选仓库，而非继承的索引或工作树。
        for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete (env as NodeJS.ProcessEnv)[key];
        const child = execFile(this.executable, ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', repository, ...args], {
          encoding: 'buffer', timeout: 10_000, maxBuffer: 16 * 1024 * 1024,
          env,
        }, (error, stdout, stderr) => {
          this.processes.delete(child);
          if (error) {
            reject(new Error(error.killed ? 'Git 查询超时（10 秒）' : stderr.toString().trim() || error.message));
          } else resolve(stdout);
        });
        this.processes.add(child);
      });
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.processes.forEach(child => child.kill());
  }

  async status(repository: string): Promise<Status> {
    return parseStatus((await this.run(repository, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'])).toString('utf8'));
  }

  async blobId(repository: string, side: Side): Promise<string | undefined> {
    safeFile(repository, side.path);
    if (side.revision === 'empty') return undefined;
    if (side.revision === 'working') throw new Error('工作区内容不使用 Git 快照');
    const spec = side.revision === 'HEAD' ? `HEAD:${side.path}` : `:${side.path}`;
    const oid = (await this.run(repository, ['rev-parse', '--verify', spec])).toString().trim();
    if (!/^[a-f0-9]{40,64}$/.test(oid)) throw new Error('Git 未返回有效的对象 ID');
    return oid;
  }
}

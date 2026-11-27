import { FSWatcher, watch } from 'node:fs';

// 非递归监听目录登记；文件内容变化仍由 Git 事件与定时扫描处理。
export class TopologyWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private disposed = false;

  constructor(private readonly changed: () => void) {}

  update(directories: Iterable<string>): void {
    if (this.disposed) return;
    const wanted = new Set(directories);
    for (const [directory, watcher] of this.watchers) {
      if (!wanted.has(directory)) { watcher.close(); this.watchers.delete(directory); }
    }
    for (const directory of wanted) {
      if (this.watchers.has(directory)) continue;
      try {
        const watcher = watch(directory, { persistent: false }, event => {
          if (this.disposed || this.watchers.get(directory) !== watcher) return;
          // rename 可能表示被监听目录自身已删除，避免继续持有旧 inode。
          if (event === 'rename') { watcher.close(); this.watchers.delete(directory); }
          this.changed();
        });
        watcher.on('error', () => {
          watcher.close();
          if (this.watchers.get(directory) === watcher) this.watchers.delete(directory);
        });
        this.watchers.set(directory, watcher);
      } catch {
        // 路径尚不存在、无权限或系统监听额度不足时由定时扫描兜底。
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.watchers.forEach(watcher => watcher.close());
    this.watchers.clear();
  }
}

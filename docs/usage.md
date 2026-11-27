# 使用手册

[返回项目首页](../README.md)

本文包含发现规则、状态语义、配置与宿主验证方式。开发命令在仓库根目录执行。

## 选择目录与安装兼容

在视图菜单选择 **选择 Worktree 父目录**，可指定 `.worktrees` 等专用目录。选择结果只保存在当前工作区插件状态中，不替换工作区文件夹。显式选择后，该目录替代默认发现入口，但 Git 登记中关联的外部 worktree 仍会显示。使用 **恢复自动发现目录** 清除选择；如设置中也配置了 `worktreeReview.root`，需同时清空。

扩展 ID 保持 `local-tools.worktree-review`，配置前缀继续使用 `worktreeReview`，以兼容已安装版本。安装器只调用标准 VS Code CLI，不修改项目或工作区设置。多 Profile 或远程开发需要在目标窗口安装；脚本不会自动选择远程环境。

## 功能与边界

| 功能 | 行为及边界 |
| --- | --- |
| 自动发现 | 从工作区仓库（含向上寻找）、直属子仓库、内置 Git 已知仓库、专门的 worktree 父目录取得入口。每个 Git 公共目录只枚举一次登记，实际路径去重，仅展示任意位置的关联 worktree；主工作区和普通仓库只作发现入口，即使存在未提交改动或历史自定义分组也不展示、不查询文件状态。不会扫描整台电脑；无关联且未被发现的仓库需要打开该仓库或选择其父目录。 |
| 目录扫描 | 只递归专门的 worktree 父目录，遇到 `.git` 文件/目录立即停止，不扫描仓库内部代码；跳过隐藏子目录、node_modules、vendor 和符号链接子目录。每次最多 2000 个目录、12 层，达到限制会提示。Git 已登记的外部 worktree 不受目录层数限制。 |
| 自动分组 | 在已发现的 worktree 父目录内，第一层仓库独立展示；完整相对路径或末级目录匹配分支时作为独立 worktree（支持 `feat/login`）；末级目录与仓库名称匹配，或不匹配分支末段时，按父目录作为功能组。这是目录约定，无法推断所有团队的任务关系。其他位置默认各自独立，同名分支不自动合并。 |
| 自定义分组 | 视图菜单“归入自定义功能组”，多选 worktree 后填写组名；相同自定义名称归为一组。仓库右键“恢复自动分组”清除该仓库的指定。映射仅保存到当前工作区插件状态，不改变目录和分支；路径改变后需重新指定。 |
| 跨工作区 | 多根工作区统一发现，真实路径去重。同名功能按完整路径保持独立；自定义组可跨根目录聚合。 |
| 特殊状态 | detached HEAD 明确显示；锁定信息在仓库提示中展示，仍读取改动；失效登记和不可访问目录显示读取错误，不执行 prune、unlock 或修复。支持直接打开标准 bare 仓库（具有 HEAD、objects、config）或其关联工作树；bare 登记本身不作为可查看文件的工作区。 |
| 改动数量 | 仓库及功能统计不同文件数。同一文件同时有暂存和未暂存改动时，只计一个文件，但在两个分类中分别展示。 |
| 已暂存 diff | HEAD → 索引；新增文件左侧为空，删除文件右侧为空，重命名使用旧路径读取 HEAD。初始仓库没有 HEAD 时，已暂存新增文件仍可比较。 |
| 未暂存 diff | 索引 → 工作区；已暂存后又修改的文件不会错误地直接与 HEAD 比较。工作区侧复用原生编辑器，包括当前未保存的编辑。 |
| 未跟踪文件 | 空白 → 工作区文件；遵守 Git 的忽略规则，不展示被忽略的文件。 |
| 冲突 | 独立列出，点击打开工作区文件，不自动合并、解决或暂存。已删除的冲突文件会提示无法打开。 |
| 快照 | HEAD 和索引内容先解析为不可变 Git blob ID，避免索引后续变化使已打开的快照内容变化；想看更新的暂存内容需重新点击文件。快照的仓库路径和 blob ID 原子保存到插件专属的工作区存储文件中，重启后可恢复；不保存文件正文。仓库被删除或 Git 对象被清理时无法恢复，需重新打开可用文件。 |
| 二进制、编码 | 通过只读文件系统提供原始字节，展示能力由 VS Code diff 编辑器决定，不承诺所有二进制都有可视化比较。单个 Git 内容读取限制 16 MiB。 |
| 子模块和符号链接 | 展示 Git 返回的状态；工作区子模块/符号链接不伪装成普通文件 diff，会提示使用 Git 查看。暂存的 gitlink 不支持普通 blob 比较。不会展开子模块内部改动。 |
| 渐进展示 | 先发布发现的列表，再读取状态；未完成时显示“正在读取”，不显示为 0 或干净。状态完成后统一更新。 |
| 自动刷新 | 使用内置 Git 的状态事件、保存文件事件和防抖刷新；视图可见时默认每 15 秒补偿扫描，发现外部 Git 操作及新增/删除目录。视图重新可见时刷新；手动刷新始终可用。 |
| 查询限制 | 最多 4 个 Git 子进程并发，单条命令超时 10 秒。使用参数数组调用，不经过 shell；禁止 Git 可选锁及交互提示，禁用 fsmonitor hook。 |
| 失败状态 | 单个仓库读取失败显示错误，不显示为“干净”。各根目录独立处理错误，失败目录在视图顶部提示，其余目录继续更新；失败目录的旧结果不会冒充最新结果。 |
| 工作区保护 | 不调用添加/替换工作区文件夹、打开/关闭原生仓库、切分支、提交、暂存、清理或删除 worktree 的操作。卸载后原工作区不需要恢复。 |
| 平台 | 支持桌面 VS Code 的可信本地工作区；扩展在 workspace host 执行，可用于远程文件系统，但首版实际验证仅覆盖 macOS。未提供浏览器版插件。 |
| 范围 | 只展示 Git 未提交改动，不包含分支相对主线的已提交差异。未保存但磁盘上无 Git 改动的文件不会单独出现在列表中。 |

## 筛选

- 放大镜：按功能名称筛选；输入留空恢复全部。
- 漏斗：切换只看有改动的功能；异常功能始终保留，避免隐藏错误。
- `…` → **切换：显示排除项**：显示或隐藏设置中排除的目录。
- 默认不排除任何功能。需要隐藏 `_archives`、`*-dev`、`*-test` 时，通过 `worktreeReview.excludedFeatures` 设置；已有显式配置继续生效。规则匹配展示的功能组名称，不直接匹配分支。
- `…` → **恢复自动发现目录**：清除此前通过选择器指定的父目录。如果配置文件显式设置了 `worktreeReview.root`，还需清空该设置。

可选设置（不配置也可直接使用）：

```json
{
  "worktreeReview.root": "",
  "worktreeReview.excludedFeatures": [],
  "worktreeReview.refreshInterval": 15
}
```

无需修改 `git.detectWorktrees`、`git.autoRepositoryDetection`、`git.scanRepositories` 或 `scm.repositories.*`。内置 Git 未打开某个仓库也不影响本视图读取状态。内置 Git API 只用于取得 Git 可执行文件和订阅变更事件；状态统一使用只读 `git status --porcelain=v1 -z` 解析，保证关闭仓库和未被原生发现的仓库行为一致。

## 本地开发

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run bundle
```

`npm run bundle` 构建 VSIX 并生成 `release/worktree-view-<版本>.zip`。开发机推荐 Node.js 22（见根目录 `.nvmrc`）与 npm，macOS/Linux 打 ZIP 需要系统 `zip`，Windows 使用 PowerShell；这些均不要求普通用户安装。

使用 TypeScript 和 VS Code 原生 Tree View / FileSystemProvider / diff 编辑器，无运行时第三方依赖。`@vscode/vsce` 仅用于打包，不随 VSIX 分发。F5 可启动扩展开发窗口。

真实扩展宿主验证：先执行 `node scripts/host-fixture.cjs` 创建临时多仓 worktree，然后启动本机 VS Code：

```sh
code --new-window \
  --user-data-dir /tmp/worktree-review-test-user \
  --extensions-dir /tmp/worktree-review-test-extensions \
  --disable-extensions --disable-workspace-trust \
  --extensionDevelopmentPath="$PWD" \
  --extensionTestsPath="$PWD/test/host.cjs" \
  <上一步输出的临时目录>
```

这里禁用其他用户扩展并使用独立用户数据目录，只对生成的测试夹具关闭工作区信任提示。测试验证跨仓发现、暂存和未暂存 diff、未保存编辑保护，以及工作区目录保持不变。成功后夹具根目录生成 `host-result.json`。

代码按职责拆分：`discovery.ts` 定位父目录与基础类型，`worktrees.ts` 发现 Git 登记并分组，`git.ts` Git 查询与差异语义，`snapshots.ts` 只读快照，`extension.ts` 原生视图和生命周期。

重启恢复验证：先运行 `test/host.cjs`，再用相同的临时项目和 `--user-data-dir` 启动一次 `test/restore-host.cjs`。后者修改测试索引后检查旧快照内容保持不变，并拒绝未登记的 URI。0.1.1 及更早版本未持久化的旧 diff 需要重新点击文件一次。

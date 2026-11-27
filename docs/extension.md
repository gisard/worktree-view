# worktree 视图 / Worktree View

在一个 VS Code 窗口中，按功能查看多个 Git worktree 的未提交改动。

## 开始使用

打开可信项目，在命令面板运行 **worktree 视图: 打开视图**。也可在源代码管理侧栏找到同名视图。普通用法无需配置目录；升级后必要时执行 **Developer: Reload Window**。

插件会从当前仓库及 Git 登记发现关联 worktree。主工作区和普通仓库仅用于发现，不显示在列表中。支持 `.worktrees/功能/仓库`、`.worktrees/分支` 和外部工作树；无法自动判断的分组，可在视图菜单选择“归入自定义功能组”。

## 功能与边界

- 文件按已暂存、未暂存、未跟踪和冲突分类，点击打开原生 diff。
- 只统计未提交文件，不统计相对主线的已提交差异。
- 视图可见时每 15 秒补偿刷新，同时响应 Git 状态、保存文件等事件。
- 不修改工作区目录，不自动暂存、提交、fetch、切换或删除 worktree。
- 文件图标和 Git 状态颜色跟随主题。没有运行时 npm 依赖或内置遥测。
- 快照恢复会在本地保存仓库路径和 Git blob ID，不保存文件正文；原仓库或对象被删除后不能恢复。
- 目录扫描最多 2000 个目录、12 层；单个 Git 命令超时 10 秒；Git 快照读取限制 16 MiB。
- 子模块内部内容、符号链接及部分二进制不提供普通文本 diff。

当前为 0.x 测试阶段，实际验证以 macOS 为主。Windows、Linux 和远程环境尚未完整验证。需要 VS Code 1.96+ 和 Git，普通用户无需 Node.js/npm。界面当前以中文为主。

默认不隐藏 dev/test 命名的工作树。可选设置：

```json
{
  "worktreeView.root": "",
  "worktreeView.excludedFeatures": [],
  "worktreeView.refreshInterval": 15
}
```

扩展 ID 为 `local-tools.worktree-view`，目前尚未上架 Marketplace。多 Profile 或远程环境请在目标窗口安装本扩展。[GitHub 源码与完整文档](https://github.com/gisard/worktree-view)中的 README、CONTRIBUTING、SECURITY 与 CHANGELOG 提供更多说明。

## English summary

Run **worktree 视图: 打开视图** after opening a trusted project. This read-only view groups uncommitted changes across linked Git worktrees by feature. Main checkouts are discovery seeds only. It preserves workspace folders and unsaved edits. Currently a macOS-first 0.x release with a Chinese UI; no stable public npm API is provided. Licensed under MIT.

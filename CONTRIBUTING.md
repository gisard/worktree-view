# 参与开发 / Contributing

欢迎提交问题和 Pull Request，中英文均可。请先阅读 README 中的功能边界。

## 开发与验证

需要 Node.js 22、npm、Git；macOS/Linux 打包 ZIP 需要系统 `zip`。普通插件用户不需要这些构建工具。

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run bundle
```

在 VS Code 打开仓库，按 F5 启动独立的扩展开发窗口。真实宿主测试见 README；测试只使用生成的临时仓库，不要用自己的业务仓库代替夹具。

GitHub CI 配置覆盖 macOS/Linux 的类型检查、Node 测试和打包，不等于 Windows、远程环境或视觉验证通过。界面/快照改动还需运行真实扩展宿主测试，并说明实际验证的平台。

## 改动原则

- 保留“功能 → worktree 仓库 → 改动分类 → 文件”的视图和只读职责。
- 主工作区仅作为发现入口，不重新加入普通 Changes。
- 不修改用户工作区目录、不自动提交/暂存/切分支、不保存未保存编辑。
- Git 使用参数数组调用，保持超时和并发限制；处理路径中的空格、Unicode、换行。
- 同一文件的暂存与未暂存状态必须独立；读取失败不能显示成干净。
- 保留现有插件 ID、配置键和快照 URI 的兼容性；需要破坏性迁移时先说明方案。
- 报告 bug 时附最小目录布局、平台、Git/VS Code/扩展版本及复现步骤；对路径、仓库名、日志先脱敏。
- PR 说明问题、改动、验证结果和未验证部分。不要提交 node_modules、dist、VSIX、release、测试产物或凭据。

## 复用

项目使用 MIT License，复用或再分发时保留许可证要求的声明。源码可 fork、修改和组合使用；当前发布物是 VS Code 扩展，`src` 内部模块与 `activate()` 返回值不构成稳定的公共库 API。扩展宿主外不能直接运行依赖 `vscode` 的模块。

## Release

维护者流程见 [发布检查](docs/releasing.md)。普通 PR 的 CI 仅生成测试产物，不发布 GitHub Release、npm 包或 Marketplace 版本。

## 构建依赖约束

`@vscode/vsce` 固定为 4.1.1，并仅对该工具的 `minimatch` 使用 11.0.1 override，以规避 GHSA-g3hv-75wg-m249。打包工具使用的命名导出 API 已核对，VSIX 内容与干净构建需一起回归。上游依赖修复后可评估移除 override；不要直接运行 `npm audit fix --force` 改动全部依赖。

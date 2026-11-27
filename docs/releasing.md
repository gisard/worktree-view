# GitHub 发布检查

仓库地址为 https://github.com/gisard/worktree-view，package.json 已填写对应 repository、bugs 和 homepage。`local-tools` 仅为当前扩展标识的一部分，不代表已注册的 Marketplace 发布者。

## 首次公开

1. 确定 GitHub owner/repository，核实开源授权与 LICENSE 署名，建立首次提交。只提交独立的插件目录，不上传父级业务项目。
2. 源码 README 保留相对文档链接；VSIX 使用 `docs/extension.md` 作为独立说明页，避免未配置仓库地址时打包失败。将真实地址填写到 package.json 的 repository、homepage 和 bugs；README 添加真实 Release 下载链接。
3. 推送后确认 GitHub Actions 实际通过。当前 CI 是 macOS/Linux 的 Node 测试与打包；Windows/远程运行仍按实际验证范围说明。
4. 添加一张使用虚构仓库名与测试文件的真实视图截图，便于用户理解，不上传业务代码或绝对路径截图。
5. 在仓库设置开启私密漏洞报告；如未开启，应先补充维护者实际可用的私密联系方式，不编造邮箱。

## 每次发布

1. 同步 package.json、package-lock.json 中的版本，更新 CHANGELOG.md；检查 README 的安装包版本。
2. 从干净目录执行 CONTRIBUTING.md 中的安装、检查、测试和打包命令。
3. 对 diff、分组、快照或生命周期改动，运行真实 VS Code 宿主测试；涉及安装器时，从最终 ZIP 解压验证。
4. 检查 VSIX 内容只包含运行文件与公开文档，ZIP 内只有该版本安装器、说明和 VSIX。确认敏感信息没有进入待提交文件及发布包。
5. 创建与包版本一致的 tag（例如 v0.2.3）；在 GitHub 创建对应 Release，上传同次构建的 VSIX 与安装 ZIP。测试阶段标为 pre-release，不使用 GitHub 自动生成的源码 ZIP 充当安装包。
6. 下载 Release 资产复核安装，明确平台验证范围。CI artifact 是检查产物，不等于已经发布 Release。

Marketplace 是独立流程，需要真实的发布者身份和授权。当前自动化不会发布到任何商店，也不包含发布凭据。

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');
const name = `worktree-view-${manifest.version}`;
const release = path.join(root, 'release');
const directory = path.join(release, name);
fs.mkdirSync(directory, { recursive: true });
const vsix = `${manifest.name}-${manifest.version}.vsix`;
fs.copyFileSync(path.join(root, vsix), path.join(directory, vsix));
for (const file of ['install.sh', 'install.command', 'install.cmd']) {
  fs.copyFileSync(path.join(root, 'installers', file), path.join(directory, file));
  if (file !== 'install.cmd') fs.chmodSync(path.join(directory, file), 0o755);
}
fs.writeFileSync(path.join(directory, 'INSTALL.txt'), `worktree 视图 ${manifest.version}\n\n需要 VS Code 1.96+ 和 Git。普通用户无需 Node.js/npm。\n\nmacOS：解压后双击 install.command。自动寻找 VS Code，无需先配置 code 命令。\nWindows：解压后双击 install.cmd（尚未真机验证）。\nLinux：解压后运行 sh install.sh（尚未真机验证）。\n\n通用方式：将同目录 VSIX 拖入 VS Code 扩展面板，或选择“从 VSIX 安装”。\n系统拦截脚本时使用上述 VSIX 方式，无需关闭系统保护。\n\n安装后打开已有项目，在命令面板运行“worktree 视图: 打开视图”。\n普通工作树自动发现，无需选择目录或修改工作区。首次激活也会提示打开入口。\n升级后旧窗口必要时执行 Developer: Reload Window。\n多 Profile 用户和 Remote SSH/WSL/容器用户请在目标 Profile/远程窗口内从 VSIX 安装。\n\n本地脚本使用标准 VS Code CLI 安装，不传 --force，不修改项目或 VS Code 设置。\n本包尚未发布到 Marketplace。当前只展示未提交改动。\n`);
const archive = path.join(release, `${name}.zip`);
const files = [vsix, 'install.sh', 'install.command', 'install.cmd', 'INSTALL.txt'];
if (process.platform === 'win32') {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Compress-Archive -LiteralPath (ConvertFrom-Json $env:WORKTREE_BUNDLE_FILES) -DestinationPath $env:WORKTREE_BUNDLE_ZIP -Force'], {
    env: { ...process.env, WORKTREE_BUNDLE_FILES: JSON.stringify(files.map(file => path.join(directory, file))), WORKTREE_BUNDLE_ZIP: archive }, stdio: 'inherit',
  });
} else {
  // 从空归档构建，避免重复打包时残留旧条目。
  fs.rmSync(archive, { force: true });
  execFileSync('zip', ['-q', archive, ...files.map(file => `${name}/${file}`)], { cwd: release, stdio: 'inherit' });
}
console.log(archive);

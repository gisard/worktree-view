#!/bin/sh
# 安装已打包的 VSIX，无需 Node.js、npm 或网络构建。
set -eu
installer_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
set -- "$installer_dir"/*.vsix
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo '安装包不完整：同目录需要且只能包含一个 VSIX。请重新解压完整安装包。' >&2
  exit 1
fi
vsix_file=$1
code_cli=${WORKTREE_VIEW_CODE:-}
if [ -z "$code_cli" ]; then
  for candidate in '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"; do
    if [ -x "$candidate" ]; then code_cli=$candidate; break; fi
  done
fi
if [ -z "$code_cli" ]; then code_cli=$(command -v code || true); fi
if [ -z "$code_cli" ] || [ ! -x "$code_cli" ]; then
  echo '未找到 VS Code。请先安装 VS Code，或在扩展面板选择“从 VSIX 安装”。' >&2
  exit 1
fi
if "$code_cli" --install-extension "$vsix_file"; then
  echo '安装命令已完成。打开 VS Code 项目，在命令面板运行“worktree 视图: 打开视图”。'
  echo '若升级后的窗口仍显示旧版本，执行 Developer: Reload Window。'
else
  echo '安装失败，请查看上方 VS Code 错误信息。未修改工作区设置。' >&2
  exit 1
fi

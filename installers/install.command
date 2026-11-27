#!/bin/sh
installer_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
sh "$installer_dir/install.sh"
install_result=$?
if [ -t 0 ]; then
  printf '\n按回车关闭此窗口…'
  read -r ignored_input
fi
exit "$install_result"

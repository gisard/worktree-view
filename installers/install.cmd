@echo off
setlocal DisableDelayedExpansion
set "CODE_CLI="
for /f "delims=" %%I in ('where code.cmd 2^>nul') do if not defined CODE_CLI set "CODE_CLI=%%I"
if not defined CODE_CLI if exist "%LocalAppData%\Programs\Microsoft VS Code\bin\code.cmd" set "CODE_CLI=%LocalAppData%\Programs\Microsoft VS Code\bin\code.cmd"
if not defined CODE_CLI if exist "%ProgramFiles%\Microsoft VS Code\bin\code.cmd" set "CODE_CLI=%ProgramFiles%\Microsoft VS Code\bin\code.cmd"
if not defined CODE_CLI (
  echo VS Code not found. Install VS Code or use Extensions: Install from VSIX.
  pause
  exit /b 1
)
set "VSIX_FILE="
for %%F in ("%~dp0*.vsix") do (
  if defined VSIX_FILE (
    echo Multiple VSIX files found. Extract a clean installation bundle.
    pause
    exit /b 1
  )
  set "VSIX_FILE=%%~fF"
)
if not defined VSIX_FILE goto missing
if not exist "%VSIX_FILE%" goto missing
call "%CODE_CLI%" --install-extension "%VSIX_FILE%"
if errorlevel 1 (
  echo Installation failed. See the VS Code error above.
  pause
  exit /b 1
)
echo Installation command completed. Run "worktree" in the VS Code command palette to open the view.
echo Reload the VS Code window if an older version is still active.
pause
exit /b 0
:missing
echo VSIX missing. Extract the complete installation bundle.
pause
exit /b 1

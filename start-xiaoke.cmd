@echo off
rem Keep this file ASCII-only: cmd.exe mis-parses multi-byte lines. The real launcher is scripts\start.mjs.
rem Options: --login, --check, --continue. Example:  start-xiaoke.cmd --continue
cd /d "%~dp0"
node scripts\start.mjs %*
if errorlevel 1 pause

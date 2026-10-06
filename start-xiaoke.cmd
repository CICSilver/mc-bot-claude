@echo off
rem Keep this file ASCII-only: cmd.exe mis-parses multi-byte lines. The real launcher is scripts\start.mjs.
rem Extra arguments are passed to claude, e.g.  start-xiaoke.cmd --continue
cd /d "%~dp0"
node scripts\start.mjs %*
if errorlevel 1 pause

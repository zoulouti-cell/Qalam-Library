@echo off
setlocal
cd /d "%~dp0"
if not exist "data\library.sqlite" (
  echo The offline library database is missing: data\library.sqlite
  pause
  exit /b 1
)
set NODE_ENV=development
set HOST=127.0.0.1
set PORT=4188
start "Qalam Library" http://127.0.0.1:4188
node server.mjs
pause

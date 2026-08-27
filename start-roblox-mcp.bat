@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%work"

if not exist package.json (
  echo Could not find package.json in "%CD%".
  echo This launcher must stay next to the repo's work folder.
  pause
  exit /b 1
)

echo Starting Roblox Studio MCP proxy...
curl.exe --silent --fail http://127.0.0.1:3197/ >nul 2>&1
if not errorlevel 1 (
  echo Roblox Studio MCP proxy is already running on port 3197.
  exit /b 0
)
call npm run mcp:roblox-proxy

if errorlevel 1 (
  echo.
  echo Proxy stopped with an error.
  pause
)

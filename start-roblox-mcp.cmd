@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

if not exist package.json (
  echo Could not find package.json in "%ROOT%".
  echo Run this launcher from the repository root.
  pause
  exit /b 1
)

echo Starting Roblox Studio MCP proxy from "%ROOT%"...
curl.exe --silent --fail http://127.0.0.1:3197/ >nul 2>&1
if not errorlevel 1 (
  echo Roblox Studio MCP proxy is already running on port 3197.
  exit /b 0
)
npm run mcp:roblox-proxy

if errorlevel 1 (
  echo.
  echo The proxy stopped with an error.
  pause
)

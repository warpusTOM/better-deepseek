@echo off
setlocal
set "ROOT=%~dp0"

start "Better DeepSeek Roblox MCP" /min cmd.exe /c ""%ROOT%start-roblox-mcp.bat""
start "Better DeepSeek Desktop MCP" /min cmd.exe /c "cd /d "%ROOT%work" && npm run mcp:desktop"

echo Roblox MCP and Desktop MCP launchers started.
echo Roblox: http://127.0.0.1:3197/mcp
echo Desktop: http://127.0.0.1:3198/mcp

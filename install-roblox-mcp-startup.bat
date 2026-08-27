@echo off
setlocal

set "ROOT=%~dp0"
set "LAUNCHER=%ROOT%start-roblox-mcp.bat"

if not exist "%LAUNCHER%" (
  echo Could not find "%LAUNCHER%".
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$startup=[Environment]::GetFolderPath('Startup'); $shell=New-Object -ComObject WScript.Shell; $shortcut=$shell.CreateShortcut((Join-Path $startup 'Better DeepSeek Roblox MCP.lnk')); $shortcut.TargetPath='%LAUNCHER%'; $shortcut.WorkingDirectory='%ROOT%'; $shortcut.WindowStyle=7; $shortcut.Description='Starts the Better DeepSeek Roblox Studio MCP proxy'; $shortcut.Save()"

if errorlevel 1 (
  echo Could not install the automatic startup shortcut.
  pause
  exit /b 1
)

echo Automatic Roblox MCP startup is installed.
echo The proxy will start after the next Windows login.
echo You can also launch "%LAUNCHER%" now.
pause

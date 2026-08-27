# Better DeepSeek MCP Connector Package

This is the Roblox Studio importable local plugin package.

## File

- `outputs/better-deepseek-mcp-connector.rbxm` (load this one)
- `outputs/better-deepseek-mcp-connector.rbxmx` (XML equivalent)

## What changed

- Added a Studio ID field for Roblox's MCP routing.
- Kept the local proxy URL and command copy buttons.
- Kept auto-retry while the panel is open.

## How to use

1. Put the `.rbxm` file into `%LOCALAPPDATA%\Roblox\Plugins`.
2. Restart Roblox Studio.
3. Open the `Better DeepSeek` toolbar.
4. Paste the `studio_id` Roblox gives you, if any.
5. Start the proxy from the repo root:

```powershell
npm run mcp:roblox-proxy
```

6. Keep the Better DeepSeek Roblox Studio MCP preset pointed at `http://127.0.0.1:3197/mcp`.

## Limitation

Roblox still needs Studio MCP enabled in Assistant Settings. The plugin can carry the `studio_id`, but it cannot invent one if Studio does not provide it.

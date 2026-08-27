-- Better DeepSeek MCP Connector for Roblox Studio
-- Local plugin package with a Studio ID field for the MCP bridge.

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

local PLUGIN_NAME = "Better DeepSeek MCP"
local TOOLBAR_NAME = "Better DeepSeek"
local WIDGET_ID = "BetterDeepSeekMcpConnector"
local DEFAULT_PROXY_URL = "http://127.0.0.1:3197/mcp"
local DEFAULT_COMMAND = 'cmd.exe /c "C:\\Users\\Administrator\\Documents\\Codex\\2026-08-26\\https-github-com-edgetype-better-deepseek\\start-roblox-mcp.bat"'
local POLL_SECONDS = 4

local toolbar = plugin:CreateToolbar(TOOLBAR_NAME)
local toggleButton = toolbar:CreateButton("MCP Connector", "Open the Better DeepSeek MCP connector", "")
toggleButton.ClickableWhenViewportHidden = true

local widgetInfo = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, false, 480, 380, 340, 240)
local widget = plugin:CreateDockWidgetPluginGui(WIDGET_ID, widgetInfo)
widget.Title = PLUGIN_NAME

local root = Instance.new("Frame")
root.BackgroundColor3 = Color3.fromRGB(24, 25, 29)
root.BorderSizePixel = 0
root.Size = UDim2.fromScale(1, 1)
root.Parent = widget
local rootCorner = Instance.new("UICorner")
rootCorner.CornerRadius = UDim.new(0, 12)
rootCorner.Parent = root
local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 14)
padding.PaddingBottom = UDim.new(0, 14)
padding.PaddingLeft = UDim.new(0, 14)
padding.PaddingRight = UDim.new(0, 14)
padding.Parent = root
local list = Instance.new("UIListLayout")
list.Padding = UDim.new(0, 8)
list.SortOrder = Enum.SortOrder.LayoutOrder
list.Parent = root

local function textLabel(text, size, bold)
  local t = Instance.new("TextLabel")
  t.BackgroundTransparency = 1
  t.Size = UDim2.new(1, 0, 0, size)
  t.Font = bold and Enum.Font.SourceSansBold or Enum.Font.SourceSans
  t.Text = text
  t.TextColor3 = Color3.fromRGB(240, 242, 245)
  t.TextSize = bold and 22 or 16
  t.TextXAlignment = Enum.TextXAlignment.Left
  t.TextWrapped = true
  return t
end

textLabel("Better DeepSeek MCP Connector", 26, true).Parent = root
local subtitle = textLabel("Point this at your local proxy and supply the Roblox studio_id when Roblox gives one.", 44, false)
subtitle.TextColor3 = Color3.fromRGB(180, 184, 192)
subtitle.Parent = root

local function field(titleText, defaultValue, placeholder)
  local lbl = textLabel(titleText, 18, true)
  lbl.TextSize = 16
  lbl.Parent = root
  local box = Instance.new("TextBox")
  box.BackgroundColor3 = Color3.fromRGB(36, 38, 44)
  box.BorderSizePixel = 0
  box.ClearTextOnFocus = false
  box.Size = UDim2.new(1, 0, 0, 32)
  box.Font = Enum.Font.Code
  box.Text = defaultValue or ""
  box.PlaceholderText = placeholder or ""
  box.TextColor3 = Color3.fromRGB(244, 245, 247)
  box.TextSize = 16
  box.TextXAlignment = Enum.TextXAlignment.Left
  box.Parent = root
  local corner = Instance.new("UICorner")
  corner.CornerRadius = UDim.new(0, 8)
  corner.Parent = box
  return box
end

local urlBox = field("Bridge URL", DEFAULT_PROXY_URL, DEFAULT_PROXY_URL)
local studioBox = field("Studio ID", "", "optional studio_id from Studio")

local buttonRow = Instance.new("Frame")
buttonRow.BackgroundTransparency = 1
buttonRow.Size = UDim2.new(1, 0, 0, 32)
buttonRow.Parent = root
local row = Instance.new("UIListLayout", buttonRow)
row.FillDirection = Enum.FillDirection.Horizontal
row.Padding = UDim.new(0, 8)
row.SortOrder = Enum.SortOrder.LayoutOrder

local function makeButton(text, color, width)
  local b = Instance.new("TextButton")
  b.BackgroundColor3 = color
  b.BorderSizePixel = 0
  b.Size = UDim2.new(0, width, 1, 0)
  b.Font = Enum.Font.SourceSansSemibold
  b.Text = text
  b.TextColor3 = Color3.fromRGB(255, 255, 255)
  b.TextSize = 16
  local c = Instance.new("UICorner")
  c.CornerRadius = UDim.new(0, 8)
  c.Parent = b
  return b
end

local refreshButton = makeButton("Check", Color3.fromRGB(55, 92, 158), 92)
refreshButton.Parent = buttonRow
local copyUrlButton = makeButton("Copy URL", Color3.fromRGB(74, 74, 84), 110)
copyUrlButton.Parent = buttonRow
local copyCommandButton = makeButton("Copy command", Color3.fromRGB(74, 74, 84), 130)
copyCommandButton.Parent = buttonRow

local status = textLabel("Status: idle", 20, true)
status.TextSize = 16
status.Parent = root

local info = Instance.new("TextLabel")
info.BackgroundColor3 = Color3.fromRGB(33, 35, 40)
info.BorderSizePixel = 0
info.Size = UDim2.new(1, 0, 0, 132)
info.Font = Enum.Font.SourceSans
info.TextColor3 = Color3.fromRGB(220, 223, 229)
info.TextSize = 16
info.TextWrapped = true
info.TextXAlignment = Enum.TextXAlignment.Left
info.TextYAlignment = Enum.TextYAlignment.Top
info.Text = table.concat({
  "1. Start the proxy: " .. DEFAULT_COMMAND,
  "2. Keep Studio MCP enabled in Assistant Settings.",
  "3. If Roblox gives you a studio_id, paste it here so the proxy can attach the right Studio instance.",
  "4. Leave this panel open and it will keep retrying.",
}, "\n")
info.Parent = root
local infoCorner = Instance.new("UICorner")
infoCorner.CornerRadius = UDim.new(0, 8)
infoCorner.Parent = info

local function setClipboard(text)
  if type(setclipboard) == "function" then
    return pcall(setclipboard, text)
  end
  return false
end

local function normalizeUrl(raw)
  raw = tostring(raw or "")
  raw = raw:gsub("^%s+", ""):gsub("%s+$", "")
  if raw == "" then raw = DEFAULT_PROXY_URL end
  return raw
end

local function buildBridgeUrl()
  local baseUrl = normalizeUrl(urlBox.Text)
  local studioId = tostring(studioBox.Text or ""):gsub("^%s+", ""):gsub("%s+$", "")
  if studioId ~= "" then
    local sep = baseUrl:find("?", 1, true) and "&" or "?"
    baseUrl = baseUrl .. sep .. "studio_id=" .. HttpService:UrlEncode(studioId)
  end
  return baseUrl
end

local function setStatus(kind, text)
  status.Text = "Status: " .. text
  if kind == "ok" then
    status.TextColor3 = Color3.fromRGB(92, 206, 124)
  elseif kind == "warn" then
    status.TextColor3 = Color3.fromRGB(245, 196, 66)
  else
    status.TextColor3 = Color3.fromRGB(236, 107, 107)
  end
end

local function checkBridge()
  local baseUrl = buildBridgeUrl()
  if not HttpService.HttpEnabled then
    setStatus("warn", "HttpService is disabled for this place.")
    return false
  end
  setStatus("warn", "Checking " .. baseUrl .. " ...")
  local ok, response = pcall(function()
    return HttpService:GetAsync(baseUrl, true)
  end)
  if not ok then
    setStatus("bad", "Bridge not reachable.")
    info.Text = table.concat({
      "The local bridge is not responding yet.",
      "",
      "Try:",
      "  1. Keep the proxy terminal open.",
      "  2. Re-open Studio and copy the studio_id if Roblox provides one.",
      "  3. Make sure Studio MCP is enabled.",
      "",
      "Error: " .. tostring(response),
    }, "\n")
    return false
  end
  local decodedOk, payload = pcall(function()
    return HttpService:JSONDecode(response)
  end)
  if decodedOk and type(payload) == "table" and payload.ok then
    setStatus("ok", "Bridge online and ready.")
    info.Text = table.concat({
      "The local bridge is responding.",
      "",
      "Session: " .. tostring(payload.sessionId or "unknown"),
      "",
      "If tool calls still fail, paste the Roblox studio_id into the field above.",
    }, "\n")
    return true
  end
  setStatus("warn", "Bridge replied, but the payload looked wrong.")
  info.Text = "The local bridge responded, but the returned JSON did not look like a health response."
  return false
end

local running = false
local function startWatcher()
  if running then return end
  running = true
  task.spawn(function()
    while running do
      if widget.Enabled then
        checkBridge()
      end
      task.wait(POLL_SECONDS)
    end
  end)
end

local function toggle()
  widget.Enabled = not widget.Enabled
  if widget.Enabled then
    checkBridge()
    startWatcher()
  else
    running = false
  end
end

toggleButton.Click:Connect(toggle)
refreshButton.MouseButton1Click:Connect(checkBridge)
copyUrlButton.MouseButton1Click:Connect(function()
  if setClipboard(normalizeUrl(urlBox.Text)) then
    setStatus("ok", "Copied bridge URL.")
  else
    setStatus("warn", "Clipboard unavailable.")
  end
end)
copyCommandButton.MouseButton1Click:Connect(function()
  if setClipboard(DEFAULT_COMMAND) then
    setStatus("ok", "Copied command.")
  else
    setStatus("warn", "Clipboard unavailable.")
  end
end)

urlBox.FocusLost:Connect(function()
  urlBox.Text = normalizeUrl(urlBox.Text)
end)
studioBox.FocusLost:Connect(function()
  studioBox.Text = tostring(studioBox.Text or ""):gsub("^%s+", ""):gsub("%s+$", "")
end)

widget:GetPropertyChangedSignal("Enabled"):Connect(function()
  if widget.Enabled then
    toggleButton:SetActive(true)
    startWatcher()
  else
    toggleButton:SetActive(false)
    running = false
  end
end)

if RunService:IsStudio() then
  setStatus("warn", "Open the panel and click Check.")
end

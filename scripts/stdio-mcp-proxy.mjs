import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3197;
const RESPONSE_TIMEOUT_MS = 30_000;
const DEFAULT_STUDIO_ID = "";

function parseArgs(argv) {
  const result = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    roblox: false,
    studioId: DEFAULT_STUDIO_ID,
    command: "",
    args: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host" && argv[i + 1]) {
      result.host = argv[++i];
      continue;
    }
    if (arg === "--port" && argv[i + 1]) {
      result.port = Number(argv[++i]) || DEFAULT_PORT;
      continue;
    }
    if (arg === "--roblox") {
      result.roblox = true;
      continue;
    }
    if (arg === "--studio-id" && argv[i + 1]) {
      result.studioId = argv[++i];
      continue;
    }
    if (arg === "--command" && argv[i + 1]) {
      result.command = argv[++i];
      while (i + 1 < argv.length && !String(argv[i + 1]).startsWith("--")) {
        result.args.push(argv[++i]);
      }
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--arg" && argv[i + 1]) {
      result.args.push(argv[++i]);
      continue;
    }
  }

  return result;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/stdio-mcp-proxy.mjs --roblox [--studio-id <id>] [--host 127.0.0.1] [--port 3197]",
    "  node scripts/stdio-mcp-proxy.mjs --command <cmd> [args...]",
    "",
    "Examples:",
    "  node scripts/stdio-mcp-proxy.mjs --roblox --port 3197",
    "  node scripts/stdio-mcp-proxy.mjs --roblox --studio-id <id> --port 3197",
    "  node scripts/stdio-mcp-proxy.mjs --command cmd.exe /c C:\\path\\to\\stdio-server.bat",
  ].join("\n");
}

function buildRobloxCommand() {
  if (process.platform !== "win32") {
    throw new Error("--roblox is currently wired for Windows. Pass --command for another platform.");
  }

  const programFilesX86 = process.env["PROGRAMFILES(X86)"] || process.env.PROGRAMFILES || "C:\\Program Files (x86)";
  const versionsRoot = path.join(programFilesX86, "Roblox", "Versions");
  if (fs.existsSync(versionsRoot)) {
    const candidates = fs.readdirSync(versionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(versionsRoot, entry.name, "StudioMCP.exe"))
      .filter((exePath) => fs.existsSync(exePath));
    if (candidates.length > 0) {
      candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      const exePath = candidates[0];
      return {
        command: exePath,
        // Roblox's current rmcp stdio transport is newline-delimited JSON.
        args: ["--stdio"],
        cwd: path.dirname(exePath),
      };
    }
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    throw new Error("LOCALAPPDATA is not set, so the Roblox Studio MCP command cannot be located.");
  }

  const robloxRoot = `${localAppData}\\Roblox`;
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", `"${robloxRoot}\\mcp.bat" --stdio`],
    cwd: robloxRoot,
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        if (!raw) return resolve(null);
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function createProcessBridge(command, args, cwd = null) {
  let child = null;
  let stdoutBuffer = "";
  const pending = new Map();
  let initialized = false;
  let initPromise = null;

  function rejectAll(err) {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    pending.clear();
  }

  function handleMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.id === undefined || message.id === null) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(new Error(message.error.message || JSON.stringify(message.error)));
      return;
    }
    entry.resolve(message.result ?? null);
  }

  function parseStdout(chunk) {
    stdoutBuffer += chunk.toString("utf8");
    while (true) {
      // New Roblox StudioMCP builds use JSONL. Keep Content-Length support for
      // older MCP servers so --command remains useful for both transports.
      stdoutBuffer = stdoutBuffer.replace(/^(?:\r?\n)+/, "");
      if (!stdoutBuffer) return;

      let body = null;
      const headerMatch = stdoutBuffer.match(/^Content-Length:\s*(\d+)\r?\n/i);
      if (headerMatch) {
        const separator = stdoutBuffer.indexOf("\r\n\r\n");
        const separatorLength = 4;
        const alternateSeparator = stdoutBuffer.indexOf("\n\n");
        const headerEnd = separator >= 0 ? separator : alternateSeparator;
        const actualSeparatorLength = separator >= 0 ? separatorLength : 2;
        if (headerEnd < 0) return;
        const contentLength = Number(headerMatch[1]);
        const bodyStart = headerEnd + actualSeparatorLength;
        if (Buffer.byteLength(stdoutBuffer.slice(bodyStart), "utf8") < contentLength) return;
        const bodyBytes = Buffer.from(stdoutBuffer.slice(bodyStart), "utf8");
        body = bodyBytes.subarray(0, contentLength).toString("utf8");
        stdoutBuffer = bodyBytes.subarray(contentLength).toString("utf8");
      } else {
        const lineEnd = stdoutBuffer.indexOf("\n");
        if (lineEnd < 0) return;
        body = stdoutBuffer.slice(0, lineEnd).replace(/\r$/, "");
        stdoutBuffer = stdoutBuffer.slice(lineEnd + 1);
      }

      try {
        handleMessage(JSON.parse(body));
      } catch (err) {
        // StudioMCP keeps diagnostics on stderr. Ignore any non-JSON stdout
        // line instead of poisoning the next valid response.
        if (body.trim().startsWith("{") || body.trim().startsWith("[")) {
          console.error("[stdio-mcp-proxy] Failed to parse child response:", err);
        }
      }
    }
  }

  function ensureChild() {
    if (child) return child;
    child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, cwd });
    child.stdout.on("data", parseStdout);
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("exit", (code, signal) => {
      rejectAll(new Error(`MCP child process exited with code ${code ?? "null"} signal ${signal ?? "null"}`));
      child = null;
      initialized = false;
      initPromise = null;
    });
    child.on("error", (err) => {
      rejectAll(err);
      child = null;
      initialized = false;
      initPromise = null;
    });
    return child;
  }

  async function call(message) {
    if (message.method === "initialize") {
      const result = await send(message);
      initialized = true;
      return result;
    }
    if (!initialized) {
      if (!initPromise) {
        initPromise = send({
          jsonrpc: "2.0",
          id: `bds-auto-initialize-${randomUUID()}`,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "better-deepseek-proxy", version: "1.0.0" },
          },
        }).then(() => {
          initialized = true;
        }).finally(() => {
          initPromise = null;
        });
      }
      await initPromise;
    }
    return send(message);
  }

  async function send(message) {
    const proc = ensureChild();
    const frame = Buffer.from(`${JSON.stringify(message)}\n`, "utf8");
    if (message.id === undefined || message.id === null) {
      proc.stdin.write(frame);
      return null;
    }
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(message.id);
        reject(new Error(`MCP request timed out after ${RESPONSE_TIMEOUT_MS}ms`));
      }, RESPONSE_TIMEOUT_MS);
      pending.set(message.id, { resolve, reject, timer });
      proc.stdin.write(frame);
    });
  }

  return { call };
}

function parseStudioList(result) {
  const text = result?.content?.find((item) => item?.type === "text")?.text;
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.studios) ? parsed.studios : [];
  } catch {
    return [];
  }
}

async function discoverStudioId(bridge, state, force = false) {
  if (!force && state.studioId) return state.studioId;
  if (state.studioIdPromise) return state.studioIdPromise;

  state.studioIdPromise = bridge.call({
    jsonrpc: "2.0",
    id: `bds-studio-discovery-${randomUUID()}`,
    method: "tools/call",
    params: { name: "list_roblox_studios", arguments: {} },
  }).then((result) => {
    const studioId = parseStudioList(result)[0]?.id || "";
    state.studioId = studioId;
    return studioId;
  }).catch((err) => {
    state.studioId = "";
    throw err;
  }).finally(() => {
    state.studioIdPromise = null;
  });

  return state.studioIdPromise;
}

function isDisconnectedStudioResult(result) {
  if (!result?.isError) return false;
  const text = result.content?.map((item) => item?.text || "").join(" ") || "";
  return /not connected|no studio available|studio.*not found|unable to reach roblox studio/i.test(text);
}

async function normalizeRobloxToolCall(body, bridge, state, preferredStudioId = "") {
  if (body?.method !== "tools/call" || !body.params || typeof body.params !== "object") return;
  const toolName = body.params.name;
  if (!toolName || toolName === "list_roblox_studios") return;

  const args = body.params.arguments && typeof body.params.arguments === "object"
    ? body.params.arguments
    : {};
  body.params.arguments = args;

  // Accept the common names DeepSeek uses when it paraphrases a tool schema.
  // Roblox's handler validates the canonical names strictly.
  if (toolName === "script_read" && !args.target_file) {
    args.target_file = args.path || args.file_path || args.targetFile || "";
  }
  if (toolName === "script_search" && !args.keywords) {
    args.keywords = args.query || args.search || args.keyword || "";
  }
  if (toolName === "execute_luau" && !args.code) {
    args.code = args.script || args.luau_code || args.lua || "";
  }

  // DeepSeek sometimes invents "Game" or omits this field entirely. Edit is
  // the safe default for inspection and script operations.
  const editTools = new Set(["execute_luau", "search_game_tree", "multi_edit"]);
  if (editTools.has(toolName) && (!args.datamodel_type || !["Edit", "Client", "Server"].includes(args.datamodel_type))) {
    args.datamodel_type = "Edit";
  }

  // In auto mode, never trust an ID supplied by the model: it may belong to
  // a previous Studio process. Explicit URL/CLI IDs remain authoritative.
  const studioId = preferredStudioId || await discoverStudioId(bridge, state);
  if (studioId) args.studio_id = studioId;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  const bridgeCommand = parsed.roblox ? buildRobloxCommand() : { command: parsed.command, args: parsed.args };
  if (!bridgeCommand.command) {
    process.stderr.write(`${usage()}\n\nMissing --command or --roblox.\n`);
    process.exit(1);
  }

  const bridge = createProcessBridge(bridgeCommand.command, bridgeCommand.args, bridgeCommand.cwd || null);
  const robloxState = { studioId: "", studioIdPromise: null };
  const sessionId = `stdio-${randomUUID()}`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${parsed.host}:${parsed.port}`}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health" || url.pathname === "/mcp")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sessionId }));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    let body;
    try {
      body = await readRequestBody(req);
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `Invalid JSON body: ${err.message}` }));
      return;
    }

    if (!body || typeof body !== "object") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Missing JSON-RPC body" }));
      return;
    }

    const effectiveStudioId = url.searchParams.get("studio_id") || url.searchParams.get("studioId") || parsed.studioId || "";
    if (effectiveStudioId) {
      if (!body.params || typeof body.params !== "object") body.params = {};
      if (body.params.studio_id === undefined && body.params.studioId === undefined) {
        body.params.studio_id = effectiveStudioId;
      }
    }

    try {
      process.stdout.write(`[stdio-mcp-proxy] ${req.method} ${url.pathname} studio_id=${effectiveStudioId || "<none>"}\n`);
      if (body.method) process.stdout.write(`[stdio-mcp-proxy] method=${body.method}\n`);
      if (parsed.roblox) await normalizeRobloxToolCall(body, bridge, robloxState, effectiveStudioId);
      let result;
      try {
        result = await bridge.call(body);
      } catch (err) {
        const canRefresh = parsed.roblox
          && body.method === "tools/call"
          && body.params?.name !== "list_roblox_studios"
          && !effectiveStudioId
          && /not connected|no studio available|studio.*not found/i.test(err.message || "");
        if (!canRefresh) throw err;
        robloxState.studioId = "";
        body.params.arguments.studio_id = await discoverStudioId(bridge, robloxState, true);
        process.stdout.write(`[stdio-mcp-proxy] refreshed studio_id=${body.params.arguments.studio_id || "<none>"}\n`);
        result = await bridge.call(body);
      }
      if (isDisconnectedStudioResult(result) && parsed.roblox && body.method === "tools/call"
        && body.params?.name !== "list_roblox_studios" && !effectiveStudioId) {
        robloxState.studioId = "";
        body.params.arguments.studio_id = await discoverStudioId(bridge, robloxState, true);
        process.stdout.write(`[stdio-mcp-proxy] refreshed studio_id=${body.params.arguments.studio_id || "<none>"}\n`);
        result = await bridge.call(body);
      }
      res.writeHead(200, { "content-type": "application/json", "Mcp-Session-Id": sessionId });
      if (body.id === undefined || body.id === null) {
        res.end(JSON.stringify({ jsonrpc: "2.0", result: null }));
      } else {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
      }
    } catch (err) {
      console.error("[stdio-mcp-proxy] Request failed:", err);
      res.writeHead(500, { "content-type": "application/json", "Mcp-Session-Id": sessionId });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { message: err.message } }));
    }
  });

  server.listen(parsed.port, parsed.host, () => {
    process.stdout.write(`stdio MCP proxy listening on http://${parsed.host}:${parsed.port} (studioId=${parsed.studioId || "auto"})\n`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[stdio-mcp-proxy] Port ${parsed.port} is already in use. The existing proxy may already be running.`);
      process.exitCode = 0;
      return;
    }
    console.error("[stdio-mcp-proxy] HTTP server error:", err);
    process.exitCode = 1;
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

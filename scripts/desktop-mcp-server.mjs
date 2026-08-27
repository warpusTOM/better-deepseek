import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);
const HOST = "127.0.0.1";
const PORT = 3198;
const ROOT = path.resolve(process.env.BDS_DESKTOP_ROOT || process.cwd());
const MAX_READ = 2_000_000;
const sessions = new Set();

function safePath(input) {
  const candidate = path.resolve(ROOT, String(input || "."));
  if (candidate !== ROOT && !candidate.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error(`Path is outside the approved workspace: ${input}`);
  }
  return candidate;
}

function toolResult(value, isError = false) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], isError };
}

const tools = [
  { name: "desktop_system_info", description: "Get safe local Windows and workspace information.", inputSchema: { type: "object", properties: {} } },
  { name: "desktop_list_directory", description: "List files and folders inside the approved workspace.", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
  { name: "desktop_read_file", description: "Read a UTF-8 text file inside the approved workspace.", inputSchema: { type: "object", properties: { path: { type: "string" }, max_chars: { type: "number" } }, required: ["path"] } },
  { name: "desktop_search_files", description: "Search file names and text inside the approved workspace.", inputSchema: { type: "object", properties: { query: { type: "string" }, path: { type: "string" }, max_results: { type: "number" } }, required: ["query"] } },
  { name: "desktop_process_list", description: "List currently running Windows processes.", inputSchema: { type: "object", properties: {} } },
  { name: "desktop_check_port", description: "Check whether a local TCP port is listening.", inputSchema: { type: "object", properties: { port: { type: "number" } }, required: ["port"] } },
  { name: "desktop_write_file", description: "Write a UTF-8 file inside the approved workspace. Requires confirm=true.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, confirm: { type: "boolean" } }, required: ["path", "content", "confirm"] } },
  { name: "desktop_launch_app", description: "Launch an approved Windows application. Requires confirm=true.", inputSchema: { type: "object", properties: { application: { type: "string", enum: ["roblox-studio", "chrome", "notepad", "calculator"] }, confirm: { type: "boolean" } }, required: ["application", "confirm"] } },
];

async function callTool(name, args = {}) {
  if (name === "desktop_system_info") return toolResult({ platform: os.platform(), release: os.release(), arch: os.arch(), hostname: os.hostname(), user: os.userInfo().username, workspace: ROOT, cpus: os.cpus().length, memoryBytes: os.totalmem() });
  if (name === "desktop_list_directory") {
    const dir = safePath(args.path || ".");
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return toolResult(entries.map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" })));
  }
  if (name === "desktop_read_file") {
    const file = safePath(args.path);
    const stat = await fs.stat(file);
    if (stat.size > MAX_READ) throw new Error(`File is larger than ${MAX_READ} bytes.`);
    return toolResult((await fs.readFile(file, "utf8")).slice(0, Number(args.max_chars) || MAX_READ));
  }
  if (name === "desktop_search_files") {
    const query = String(args.query || "").toLowerCase();
    const base = safePath(args.path || ".");
    const max = Math.min(200, Math.max(1, Number(args.max_results) || 50));
    const results = [];
    async function visit(dir) {
      if (results.length >= max) return;
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await visit(full);
        else if (entry.name.toLowerCase().includes(query)) results.push({ path: path.relative(ROOT, full), match: "filename" });
        else if (results.length < max && (await fs.stat(full)).size < 500_000) {
          try { if ((await fs.readFile(full, "utf8")).toLowerCase().includes(query)) results.push({ path: path.relative(ROOT, full), match: "content" }); } catch { /* binary/unreadable */ }
        }
        if (results.length >= max) return;
      }
    }
    await visit(base);
    return toolResult(results);
  }
  if (name === "desktop_process_list") {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "Get-Process | Select-Object Id,ProcessName,CPU | ConvertTo-Json -Compress"], { timeout: 10_000 });
    return toolResult(JSON.parse(stdout || "[]"));
  }
  if (name === "desktop_check_port") {
    const port = Number(args.port);
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", `Get-NetTCPConnection -LocalPort ${Math.max(1, Math.min(65535, port))} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress`], { timeout: 10_000 });
    return toolResult(stdout.trim() ? JSON.parse(stdout) : []);
  }
  if (name === "desktop_write_file") {
    if (args.confirm !== true) return toolResult("Write blocked. Repeat with confirm=true after reviewing the target path.", true);
    const file = safePath(args.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, String(args.content), "utf8");
    return toolResult({ written: path.relative(ROOT, file), chars: String(args.content).length });
  }
  if (name === "desktop_launch_app") {
    if (args.confirm !== true) return toolResult("Launch blocked. Repeat with confirm=true.", true);
    const commands = { "roblox-studio": " RobloxStudioBeta.exe", chrome: " chrome.exe", notepad: " notepad.exe", calculator: " calc.exe" };
    const command = commands[args.application];
    if (!command) throw new Error("Application is not approved.");
    execFile("cmd.exe", ["/c", "start", "", command.trim()], { windowsHide: true });
    return toolResult({ launched: args.application });
  }
  throw new Error(`Unknown desktop tool: ${name}`);
}

function body(req) { return new Promise((resolve, reject) => { let data = ""; req.on("data", (chunk) => { data += chunk; if (data.length > 5_000_000) reject(new Error("Request too large")); }); req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch (err) { reject(err); } }); req.on("error", reject); }); }

const server = http.createServer(async (req, res) => {
  if (req.method === "GET") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, server: "better-deepseek-desktop", workspace: ROOT })); return; }
  if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
  try {
    const request = await body(req);
    let result;
    if (request.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "BetterDeepSeekDesktop", version: "1.0.0" } };
    else if (request.method === "notifications/initialized") result = null;
    else if (request.method === "tools/list") result = { tools };
    else if (request.method === "tools/call") result = await callTool(request.params?.name, request.params?.arguments || {});
    else throw new Error(`Unsupported MCP method: ${request.method}`);
    res.writeHead(200, { "content-type": "application/json", "Mcp-Session-Id": [...sessions][0] || randomUUID() });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  } catch (err) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", error: { message: err.message } })); }
});
server.listen(PORT, HOST, () => console.log(`Desktop MCP server listening on http://${HOST}:${PORT}/mcp (workspace=${ROOT})`));
server.on("error", (err) => { if (err.code === "EADDRINUSE") { console.error(`Desktop MCP server already running on ${HOST}:${PORT}.`); process.exitCode = 0; } else { throw err; } });

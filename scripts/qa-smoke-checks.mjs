#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const checks = [];

function mark(name, status, details = "") {
  checks.push({ name, status, ...(details ? { details } : {}) });
  const prefix = status === "PASS" ? "[PASS]" : "[FAIL]";
  console.log(`${prefix} ${name}${details ? `\n  ${details}` : ""}`);
}

function execNodeCommand(argv, options = {}) {
  const proc = spawnSync(process.execPath, ["dist/cli.js", ...argv], {
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, ...options.env },
  });

  const stdout = String(proc.stdout ?? "");
  const stderr = String(proc.stderr ?? "");
  if (proc.status !== 0) {
    throw new Error(`${argv.join(" ")} failed (exit ${proc.status}).\n${stderr || stdout}`);
  }
  return { stdout, stderr };
}

function assertJsonPayload(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`${label} did not emit JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function failFast(message) {
  console.error(`[RESULT] FAIL`);
  if (message) console.error(message);
  process.exit(1);
}

console.log("[INFO] QA Smoke Checks");
console.log(`[INFO] Node ${process.version}`);
console.log(`[INFO] PID ${process.pid}`);
console.log(`[INFO] cwd ${process.cwd()}`);
console.log(`[INFO] platform ${process.platform} ${process.arch}`);
console.log(`[INFO] has GITHUB_TOKEN: ${Boolean(process.env.GITHUB_TOKEN)}`);
console.log(`[INFO] has DISPATCH_TARGETS: ${Boolean(process.env.DISPATCH_TARGETS)}`);

if (!process.env.GITHUB_TOKEN) {
  console.log("[WARN] GITHUB_TOKEN is not set; install flows may be limited.");
}

try {
  const dist = resolve(process.cwd(), "dist", "cli.js");
  statSync(dist);
  mark("Prerequisite: dist artifact exists", "PASS", dist);
} catch {
  mark("Prerequisite: dist artifact exists", "FAIL", "dist/cli.js not found. Run npm run build first.");
  failFast("Please build first so CLI artifact exists.");
}

// Sidecar bootstrap via doctor payload.
try {
  const { stdout } = execNodeCommand(["mcp", "--doctor"]);
  const doctor = assertJsonPayload(stdout, "mcp --doctor");
  if (doctor.ok === true) {
    mark("Sidecar bootstrap", "PASS", "mcp --doctor completed and returned ok=true");
  } else {
    mark("Sidecar bootstrap", "FAIL", `mcp --doctor ok=${doctor.ok}`);
  }
} catch (err) {
  mark("Sidecar bootstrap", "FAIL", err instanceof Error ? err.message : String(err));
}

// MCP connect/install smoke using hosted install output.
try {
  const { stdout } = execNodeCommand(["chatgpt", "install", "--no-open", "--no-tunnel"]);
  const mcpLineMatch = /MCP URL:\s*(https:\/\/[^\s]+\/mcp)/.exec(stdout);
  if (!mcpLineMatch) {
    mark("MCP connect/install", "FAIL", "chatgpt install did not print an MCP URL");
  } else {
    mark("MCP connect/install", "PASS", `chatgpt install -> ${mcpLineMatch[1]}`);
  }
} catch (err) {
  mark("MCP connect/install", "FAIL", err instanceof Error ? err.message : String(err));
}

// MCP config and codex install smoke path to temp file.
try {
  const { stdout } = execNodeCommand(["mcp", "--config-snippet", "--package", "goblintown@latest"]);
  assertJsonPayload(stdout, "mcp --config-snippet");
  mark("MCP config-snippet", "PASS", "valid JSON payload emitted");
} catch (err) {
  mark("MCP config-snippet", "FAIL", err instanceof Error ? err.message : String(err));
}

try {
  const cfgDir = mkdtempSync(resolve(tmpdir(), "goblintown-mcp-config-"));
  const cfgPath = resolve(cfgDir, "codex-mcp.toml");
  execNodeCommand(["mcp", "--install-codex", "--codex-config", cfgPath]);
  const updated = readFileSync(cfgPath, "utf8");
  if (!updated.includes("[mcp_servers.goblintown]")) {
    throw new Error("Expected [mcp_servers.goblintown] section in codex config");
  }
  mark("MCP install to config", "PASS", `written ${cfgPath}`);
} catch (err) {
  mark("MCP install to config", "FAIL", err instanceof Error ? err.message : String(err));
}

// Plugin and sidecar skill command discoverability.
for (const subcmd of [["plugin", "--help"], ["skill", "--help"]]) {
  const label = `Command discoverability: goblintown ${subcmd.join(" ")}`;
  try {
    const proc = execNodeCommand(subcmd);
    if (!proc.stdout) {
      throw new Error("empty output");
    }
    mark(label, "PASS", "command invoked successfully");
  } catch (err) {
    mark(label, "FAIL", err instanceof Error ? err.message : String(err));
  }
}

const failed = checks.some((item) => item.status === "FAIL");
if (failed) {
  console.error("\n[RESULT] FAIL");
  process.exitCode = 1;
} else {
  console.log("\n[RESULT] PASS");
}


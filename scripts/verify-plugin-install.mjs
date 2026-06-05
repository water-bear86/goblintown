#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const results = [];
let failed = false;

function runShell(command, label) {
  try {
    const output = execFileSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output: output.trim() };
  } catch (error) {
    const message = (error.stdout?.toString() || error.stderr?.toString() || String(error.message || error))
      .toString()
      .trim();
    return { ok: false, output: message, label };
  }
}

function check(label, ok, detail, hint) {
  results.push({
    label,
    ok,
    detail: detail || "",
    hint: hint || "",
  });
  if (!ok) failed = true;
}

function fileExists(file) {
  return existsSync(file);
}

function jsonHasGoblinPlugin(path) {
  if (!fileExists(path)) return false;
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  const plugins = parsed?.plugins;
  if (!Array.isArray(plugins)) return false;
  return plugins.some((entry) => entry?.name === "goblintown");
}

const marketPath = join(homedir(), ".agents", "plugins", "marketplace.json");
const pluginDir = join(homedir(), "plugins", "goblintown");
const codexToml = join(homedir(), ".codex", "config.toml");

const pluginList = runShell("codex plugin list");
check(
  "codex plugin list",
  pluginList.ok && /goblintown@personal/i.test(pluginList.output),
  pluginList.ok ? pluginList.output : pluginList.output,
  "Install Codex first, then run `codex plugin add goblintown@personal`.",
);

check(
  "Codex marketplace entry",
  jsonHasGoblinPlugin(marketPath),
  fileExists(marketPath) ? "marketplace file found" : "missing marketplace file",
  `Ensure ${marketPath} exists and includes plugin entry for ${"goblintown"}.`,
);

check(
  "Plugin payload location",
  fileExists(pluginDir),
  fileExists(pluginDir) ? `found ${pluginDir}` : "missing plugin directory",
  `Run ` +
    `npx -y goblintown@latest plugin install` +
    " to refresh ~/plugins/goblintown.",
);

for (const pluginFile of [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "skills/goblintown-sidecar/SKILL.md",
]) {
  check(
    `Plugin payload file: ${pluginFile}`,
    fileExists(join(pluginDir, pluginFile)),
    fileExists(join(pluginDir, pluginFile)) ? "present" : "missing",
    "Composer visibility or install path may be stale; re-run plugin install.",
  );
}

check(
  "Codex MCP config",
  fileExists(codexToml) && /mcp_servers\.goblintown/.test(readFileSync(codexToml, "utf8")),
  fileExists(codexToml) ? "found `[mcp_servers.goblintown]`" : "missing ~/.codex/config.toml",
  "Run `npx -y goblintown@latest mcp --install-codex` and restart Codex.",
);

const doctor = runShell("npx -y goblintown@latest mcp --doctor");
check(
  "MCP doctor",
  doctor.ok && /"ok":\s*true/.test(doctor.output),
  doctor.ok ? doctor.output : `failed: ${doctor.output}`,
  "If output says command unavailable, install matching npm package and re-run.",
);

for (const item of results) {
  const prefix = item.ok ? "pass" : "fail";
  const line = `[${prefix}] ${item.label}` + (item.detail ? ` -> ${item.detail}` : "");
  console.log(line);
  if (!item.ok && item.hint) {
    console.log(`  hint: ${item.hint}`);
  }
}

if (failed) {
  console.error("\nSmoke check failed. Run the suggested action for each failure, then retry.");
  process.exitCode = 1;
} else {
  console.log(
    "\nSmoke check passed. If the plugin is still not visible in composer, restart Codex to refresh + icon cache.",
  );
}

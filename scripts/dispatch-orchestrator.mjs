#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envFiles = [".env.production.local", ".env.local", ".env"];

for (const file of envFiles) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) continue;

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

const secret = process.env.BL33P_CRON_SECRET || process.env.CRON_SECRET;
const url = process.env.DISPATCH_URL || "https://goblintown-mcp.vercel.app/api/cron/dispatch";

if (!secret) {
  console.error("Missing BL33P_CRON_SECRET or CRON_SECRET.");
  process.exit(1);
}

const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  },
});

const body = await response.text();
let parsed;
try {
  parsed = JSON.parse(body);
} catch {
  parsed = body;
}

if (typeof parsed === "string") {
  console.log(parsed);
} else {
  console.log(JSON.stringify(parsed, null, 2));
}

if (!response.ok) {
  process.exit(1);
}

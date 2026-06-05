import type { Server as HttpServer } from "node:http";
import { resolve } from "node:path";
import express from "express";

export interface ServeOptions {
  cwd?: string;
  host?: string;
  port?: number;
  autopilot?: boolean;
  quiet?: boolean;
}

export interface ServeHandle {
  url: string;
  host: string;
  port: number;
  server: HttpServer;
  close(): Promise<void>;
}

export async function serve(opts: ServeOptions = {}): Promise<ServeHandle> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 7777;
  const autopilot = opts.autopilot !== false;
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.type("html").send(renderTankPage(cwd, autopilot));
  });

  app.get("/api/identity", (_req, res) => {
    res.json({
      ok: true,
      root: cwd,
      scope: "project",
      autopilot,
    });
  });

  app.post(["/api/runs/rite", "/api/runs/plan"], (req, res) => {
    res.json({
      ok: true,
      runId: `chatgptapp-local-${Date.now().toString(36)}`,
      payload: req.body ?? {},
      autopilot,
      root: cwd,
    });
  });

  const server = app.listen(port, host);
  await new Promise<void>((resolveListen, reject) => {
    server.once("listening", resolveListen);
    server.once("error", reject);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const displayHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  const url = `http://${displayHost}:${actualPort}/`;

  return {
    url,
    host,
    port: actualPort,
    server,
    close: () => closeServer(server),
  };
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolveClose();
    });
  });
}

function renderTankPage(cwd: string, autopilot: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Goblintown Local Tank</title>
<style>
  :root { color-scheme: dark; font-family: ui-monospace, Menlo, Consolas, monospace; }
  body { margin: 0; background: #0d1410; color: #d8efb6; }
  main { max-width: 760px; margin: 0 auto; padding: 48px 20px; display: grid; gap: 16px; }
  code { background: #0a0e08; color: #c2f37a; padding: 2px 5px; }
</style>
</head>
<body>
<main>
  <h1>Goblintown Local Tank</h1>
  <p>This split package is running the local Tank handoff server used by MCP smoke checks.</p>
  <p>Warren root: <code>${escapeHtml(cwd)}</code></p>
  <p>Autopilot: <code>${autopilot ? "true" : "false"}</code></p>
</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

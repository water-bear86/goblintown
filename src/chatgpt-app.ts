import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  buildGoblintownMcpTools,
  createGoblintownMcpServer,
  GOBLINTOWN_CHATGPT_WIDGET_URI,
} from "./mcp.js";
import {
  loadAgentDutyState,
  operatorPassword,
  operatorPasswordConfigured,
  setAgentDuty,
} from "./lib/agent-duty.js";
import {
  clearOperatorSession,
  completeGithubOperatorLogin,
  getOperatorSession,
  githubOperatorAuthConfigured,
  startGithubOperatorLogin,
} from "./lib/operator-auth.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = join(MODULE_DIR, "..", "site");
const CANONICAL_HOSTED_BASE_URL = "https://goblintown-mcp.vercel.app";

type ReadinessState = "ready" | "bounded" | "local_only" | "manual";

interface LaunchReadinessItem {
  key: string;
  label: string;
  state: ReadinessState;
  detail: string;
}

interface ChatGptLaunchReadiness {
  ok: true;
  app: string;
  version: string;
  hosted: boolean;
  publicBaseUrl: string;
  universalMcpUrl: string;
  currentMcpUrl: string;
  widgetUri: string;
  tokenPolicy: {
    defaultRunner: "chatgpt_host";
    openAiApiKeyRequired: false;
    localProviderSpend: string;
  };
  reviewerSurfaces: Array<{
    path: string;
    label: string;
    state: ReadinessState;
    detail: string;
  }>;
  controls: LaunchReadinessItem[];
  evidence: LaunchReadinessItem[];
  boundaries: string[];
}

export interface GoblintownChatGptAppOptions {
  cwd?: string;
  host?: string;
  port?: number;
  allowedHosts?: string[];
  publicBaseUrl?: string;
  widgetDomain?: string;
  hostedMode?: boolean;
}

type ChatGptExpressApp = ReturnType<typeof createMcpExpressApp>;

export interface GoblintownChatGptExpressAppHandle {
  app: ChatGptExpressApp;
  url: string;
  mcpUrl: string;
  healthUrl: string;
  setPublicBaseUrl(url: string): void;
  addAllowedHost(host: string): void;
}

export interface GoblintownChatGptAppHandle {
  url: string;
  mcpUrl: string;
  healthUrl: string;
  host: string;
  port: number;
  server: HttpServer;
  setPublicBaseUrl(url: string): void;
  addAllowedHost(host: string): void;
  close(): Promise<void>;
}

export interface GoblintownChatGptQuickTunnelOptions {
  command?: string;
  args?: string[];
  timeoutMs?: number;
  readyTimeoutMs?: number;
  validateUrl?: boolean;
  onTunnelUrl?: (url: string) => void;
  env?: NodeJS.ProcessEnv;
}

export interface GoblintownChatGptQuickTunnelHandle {
  url: string;
  mcpUrl: string;
  close(): Promise<void>;
}

export function defaultChatGptAppPort(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env.GOBLINTOWN_CHATGPT_PORT ?? env.PORT ?? 8787);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 8787;
}

export function defaultChatGptAppHost(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.GOBLINTOWN_CHATGPT_HOST?.trim() || "127.0.0.1";
}

export function defaultChatGptAllowedHosts(
  env: Record<string, string | undefined> = process.env,
): string[] | undefined {
  const raw = env.GOBLINTOWN_CHATGPT_ALLOWED_HOSTS;
  if (!raw) return undefined;
  const hosts = raw
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : undefined;
}

export function defaultChatGptMcpTankPort(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env.GOBLINTOWN_MCP_TANK_PORT ?? env.PORT ?? 7777);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 7777;
}

async function readIncomingRequestBody(req: Request): Promise<Buffer | undefined> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks);
}

async function proxyToTankServer(
  req: Request,
  res: Response,
  base: string,
  pathOverride?: string,
): Promise<void> {
  const rawPath = pathOverride ?? req.originalUrl ?? req.url ?? "/";
  const target = new URL(rawPath, `${base}/`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (key.toLowerCase() === "host" || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
    } else {
      headers.set(key, value);
    }
  }
  const bodyBuffer = await readIncomingRequestBody(req);
  const body: BodyInit | undefined = bodyBuffer
    ? new Uint8Array(bodyBuffer).slice().buffer
    : undefined;
  const upstream = await fetch(target.toString(), {
    method: req.method,
    headers,
    body,
    redirect: "manual",
  });
  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    const normalized = key.toLowerCase();
    if (["connection", "transfer-encoding", "content-encoding", "content-length"].includes(normalized)) {
      return;
    }
    res.setHeader(key, value);
  });
  if (!upstream.body) {
    res.end();
    return;
  }
  const upstreamStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
  upstreamStream.pipe(res);
}

function bindTankProxyRoutes(app: ReturnType<typeof createMcpExpressApp>, tankPort: number): void {
  const base = `http://127.0.0.1:${tankPort}`;

  app.use("/tank", async (req, res) => {
    try {
      const upstreamPath = req.originalUrl.startsWith("/tank")
        ? req.originalUrl.slice("/tank".length) || "/"
        : req.originalUrl;
      await proxyToTankServer(req, res, base, upstreamPath);
    } catch (err) {
      res.status(502).json({
        error: `Failed to proxy to local Tank at ${base}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  app.use("/api", async (req, res) => {
    try {
      await proxyToTankServer(req, res, base);
    } catch (err) {
      res.status(502).json({
        error: `Failed to proxy to local Tank at ${base}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
}

export function defaultChatGptPublicBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return normalizePublicBaseUrl(
    env.GOBLINTOWN_CHATGPT_PUBLIC_BASE_URL ??
      env.VERCEL_PROJECT_PRODUCTION_URL ??
      env.VERCEL_URL,
  );
}

export function createGoblintownChatGptExpressApp(
  opts: GoblintownChatGptAppOptions = {},
): GoblintownChatGptExpressAppHandle {
  const cwd = opts.cwd ?? process.cwd();
  const host = opts.host ?? defaultChatGptAppHost();
  const allowedHosts = normalizeAllowedHosts([
    ...(opts.allowedHosts ?? defaultChatGptAllowedHosts() ?? []),
    publicBaseHostname(opts.publicBaseUrl),
    publicBaseHostname(defaultChatGptPublicBaseUrl()),
  ]);
  const app = createMcpExpressApp({ host, allowedHosts });
  let baseUrl = normalizePublicBaseUrl(opts.publicBaseUrl ?? defaultChatGptPublicBaseUrl());
  app.use("/assets", express.static(SITE_DIR + "/assets"));
  const addAllowedHost = (host: string): void => {
    const hostname = normalizeAllowedHostname(host);
    if (hostname && allowedHosts && !allowedHosts.includes(hostname)) {
      allowedHosts.push(hostname);
    }
  };
  const resolveBaseUrl = (req?: Request): string =>
    baseUrl ?? requestBaseUrl(req) ?? localPublicBaseUrl(undefined, host, opts.port ?? defaultChatGptAppPort());

  app.get("/", (req, res) => {
    res.type("html").send(renderLandingPage(resolveBaseUrl(req)));
  });

  app.get(["/privacy", "/privacy.html"], (_req, res) => {
    sendSitePage(res, "privacy.html");
  });

  app.get(["/terms", "/terms.html"], (_req, res) => {
    sendSitePage(res, "terms.html");
  });

  app.get(["/dashboard", "/dashboard.html"], (_req, res) => {
    sendSitePage(res, "dashboard.html");
  });

  app.get(["/admin", "/admin.html"], (_req, res) => {
    sendSitePage(res, "admin.html");
  });

  app.get("/api/submission/readiness", (req, res) => {
    res.json(buildChatGptLaunchReadiness(resolveBaseUrl(req), !!opts.hostedMode));
  });

  app.get("/api/dev/hosted-rite-packet", (_req, res) => {
    const readiness = buildChatGptLaunchReadiness(resolveBaseUrl(req), !!opts.hostedMode);
    res.json(buildHostedRiteDebugPacket(readiness));
  });

  app.get("/api/dashboard/readiness", (req, res) => {
    res.json(buildChatGptLaunchReadiness(resolveBaseUrl(req), !!opts.hostedMode));
  });

  app.get("/api/admin/readiness", (req, res) => {
    res.json({
      ...buildChatGptLaunchReadiness(resolveBaseUrl(req), !!opts.hostedMode),
      authenticated: !!getOperatorSession(req),
      passwordConfigured: operatorPasswordConfigured(),
      githubConfigured: githubOperatorAuthConfigured(),
    });
  });

  app.get("/api/admin/auth/status", (req, res) => {
    const session = getOperatorSession(req);
    res.json({
      ok: true,
      authenticated: !!session,
      githubConfigured: githubOperatorAuthConfigured(),
      passwordConfigured: operatorPasswordConfigured(),
      user: session
        ? {
            login: session.login,
            name: session.name,
            avatarUrl: session.avatarUrl,
            expiresAt: session.expiresAt,
          }
        : undefined,
    });
  });

  app.get("/api/admin/auth/github/start", (req, res) => {
    startGithubOperatorLogin(req, res, resolveBaseUrl(req));
  });

  app.get("/api/admin/auth/github/callback", async (req, res) => {
    try {
      await completeGithubOperatorLogin(req, res, resolveBaseUrl(req));
    } catch (err) {
      res.status(502).send(errorMessage(err));
    }
  });

  app.post("/api/admin/auth/logout", (_req, res) => {
    clearOperatorSession(res);
    res.json({ ok: true });
  });

  app.get("/api/admin/agent-duty", async (req, res) => {
    if (!authorizedAdminRequest(req)) {
      res.status(401).json({
        ok: false,
        error: "unauthorized",
        configured: operatorPasswordConfigured(),
      });
      return;
    }
    try {
      res.json({
        ok: true,
        configured: true,
        ...(await loadAgentDutyState()),
      });
    } catch (err) {
      res.status(502).json({ ok: false, error: errorMessage(err) });
    }
  });

  app.post("/api/admin/agent-duty", async (req, res) => {
    if (!authorizedAdminRequest(req)) {
      res.status(401).json({
        ok: false,
        error: "unauthorized",
        configured: operatorPasswordConfigured(),
      });
      return;
    }
    const body = (req.body ?? {}) as { agent?: unknown; onDuty?: unknown };
    if (typeof body.agent !== "string" || typeof body.onDuty !== "boolean") {
      res.status(400).json({ ok: false, error: "agent and onDuty are required" });
      return;
    }
    try {
      res.json({
        ok: true,
        configured: true,
        ...(await setAgentDuty(body.agent, body.onDuty)),
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: errorMessage(err) });
    }
  });

  bindTankProxyRoutes(app, defaultChatGptMcpTankPort());

  app.get("/healthz", (req, res) => {
    const currentBaseUrl = resolveBaseUrl(req);
    const readiness = buildChatGptLaunchReadiness(currentBaseUrl, !!opts.hostedMode);
    res.json({
      ok: true,
      name: "Goblintown ChatGPT App",
      version: "1.0-dev",
      mode: opts.hostedMode ? "hosted" : "local",
      mcpUrl: `${currentBaseUrl}/mcp`,
      widgetUri: GOBLINTOWN_CHATGPT_WIDGET_URI,
      submissionReadinessUrl: `${currentBaseUrl}/api/submission/readiness`,
      dashboardUrl: `${currentBaseUrl}/dashboard.html`,
      adminUrl: `${currentBaseUrl}/admin.html`,
      tokenPolicy: readiness.tokenPolicy,
      tools: buildGoblintownMcpTools({
        chatgptApp: true,
        hostedApp: opts.hostedMode,
      }).map((tool) => tool.name),
      notes: [
        opts.hostedMode
          ? "Hosted mode exposes Goblintown board tools over a stable HTTPS endpoint."
          : "Use an HTTPS tunnel or deployment URL for ChatGPT Developer Mode.",
        "Rites and plans default to ChatGPT-hosted board packets; no OpenAI API key is required.",
      ],
    });
  });

  app.post("/mcp", async (req, res) => {
    const currentBaseUrl = resolveBaseUrl(req);
    const mcpServer = createGoblintownMcpServer({
      cwd,
      chatgptApp: true,
      chatgptTankUrl: currentBaseUrl,
      chatgptWidgetDomain: opts.widgetDomain ?? currentBaseUrl,
      hostedApp: opts.hostedMode,
      hostedBaseUrl: currentBaseUrl,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    try {
      res.on("close", () => {
        void transport.close();
        void mcpServer.close();
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: resolveChatGptMcpErrorMessage(err, currentBaseUrl, opts.hostedMode),
          },
          id: null,
        });
      }
      console.error(
        `chatgpt mcp startup error [${opts.hostedMode ? "hosted" : "local"}] ${currentBaseUrl}`,
        err,
      );
    } finally {
      if (!res.writableEnded) {
        void transport.close();
      }
    }
  });

  app.get("/mcp", (req, res) => {
    res.setHeader("Allow", "POST");
    if (req.accepts("html")) {
      res.status(405).type("html").send(renderMcpGetPage(resolveBaseUrl(req)));
      return;
    }
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST /mcp." },
      id: null,
    });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Stateless endpoint has no session to terminate." },
      id: null,
    });
  });

  return {
    app,
    get url() {
      return resolveBaseUrl();
    },
    get mcpUrl() {
      return `${resolveBaseUrl()}/mcp`;
    },
    get healthUrl() {
      return `${resolveBaseUrl()}/healthz`;
    },
    setPublicBaseUrl(url: string): void {
      baseUrl = normalizePublicBaseUrl(url);
      if (baseUrl) addAllowedHost(baseUrl);
    },
    addAllowedHost,
  };
}

function buildChatGptLaunchReadiness(baseUrl: string, hosted: boolean): ChatGptLaunchReadiness {
  const currentMcpUrl = `${baseUrl}/mcp`;
  const universalMcpUrl = `${CANONICAL_HOSTED_BASE_URL}/mcp`;
  return {
    ok: true,
    app: "Goblintown ChatGPT App",
    version: "1.0",
    hosted,
    publicBaseUrl: baseUrl,
    universalMcpUrl,
    currentMcpUrl,
    widgetUri: GOBLINTOWN_CHATGPT_WIDGET_URI,
    tokenPolicy: {
      defaultRunner: "chatgpt_host",
      openAiApiKeyRequired: false,
      localProviderSpend: hosted
        ? "disabled on the hosted endpoint"
        : "available only when the local adapter receives an explicit local_provider request",
    },
    reviewerSurfaces: [
      {
        path: "/",
        label: "Hosted handoff page",
        state: "ready",
        detail: "Shows the MCP URL, legal links, and ChatGPT Developer Mode connection target.",
      },
      {
        path: "/dashboard.html",
        label: "User dashboard",
        state: "ready",
        detail: "Shows reviewer-safe run history, artifact evidence, and rerun prompts without claiming cloud account storage.",
      },
      {
        path: "/admin.html",
        label: "Operator admin",
        state: "bounded",
        detail: "Shows authenticated duty controls when configured and public launch-readiness controls otherwise.",
      },
      {
        path: "/privacy.html",
        label: "Privacy policy",
        state: "ready",
        detail: "Documents hosted, Codex, local Tank, provider, and retention boundaries.",
      },
      {
        path: "/terms.html",
        label: "Terms of service",
        state: "ready",
        detail: "Documents review, provider spend, local data, and host/provider responsibilities.",
      },
      {
        path: "/api/dev/hosted-rite-packet",
        label: "Safe hosted rite debug packet",
        state: "bounded",
        detail: "Returns the public hosted packet shape, safe test prompts, and safety-boundary notes without exposing hidden prompts or raw tool internals.",
      },
    ],
    controls: [
      {
        key: "provider_model_routing",
        label: "Provider and model routing",
        state: hosted ? "bounded" : "ready",
        detail: hosted
          ? "Hosted ChatGPT mode always returns ChatGPT-host board packets and does not spend local/provider tokens."
          : "Local adapter can inspect provider routes and can opt into local_provider execution explicitly.",
      },
      {
        key: "memory_retention",
        label: "Memory and artifact retention",
        state: "bounded",
        detail: "Hosted mode returns structured packets only; persistent Hoard artifacts, imported chats, and embeddings remain local-only.",
      },
      {
        key: "account_session",
        label: "Account and session controls",
        state: "bounded",
        detail: "Public reviewer pages do not require a user account. Operator GitHub/password auth is available only when configured.",
      },
      {
        key: "specialist_thresholds",
        label: "Specialist and fallback thresholds",
        state: "ready",
        detail: "goblintown_rite and goblintown_plan expose pack size, specialist cap, fallback, debate, and node limits as explicit tool inputs.",
      },
      {
        key: "run_history_artifacts",
        label: "Run history and artifact details",
        state: "bounded",
        detail: "Dashboard shows reviewer evidence and prompts for reruns; durable local run history remains in the local Tank and CLI.",
      },
    ],
    evidence: [
      {
        key: "build",
        label: "Build",
        state: "manual",
        detail: "Run npm run build before submission.",
      },
      {
        key: "vercel",
        label: "Vercel hosted adapter check",
        state: "manual",
        detail: "Run npm run verify:vercel to prove the hosted entry exports the expected MCP surface.",
      },
      {
        key: "chatgpt_hosted",
        label: "Hosted MCP check",
        state: "manual",
        detail: `Run npm run verify:chatgpt:hosted against ${universalMcpUrl}.`,
      },
      {
        key: "smoke",
        label: "Package smoke gate",
        state: "manual",
        detail: "Run npm run verify:smoke to check sidecar bootstrap, plugin, skill, and MCP install discoverability.",
      },
      {
        key: "reviewer_walkthrough",
        label: "Manual reviewer walkthrough",
        state: "manual",
        detail: "Record Developer Mode connect, tank, plan, doctor, legal links, and disconnect evidence.",
      },
    ],
    boundaries: [
      "Hosted ChatGPT mode does not require OPENAI_API_KEY.",
      "Hosted ChatGPT mode rejects local_provider Tank execution.",
      "Hosted debug endpoints return sanitized packet templates only; raw internal prompts and hidden tool payloads are intentionally not exposed.",
      "The public endpoint does not read private local files unless the user runs a local adapter and asks for local context.",
      "Provider keys, persistent Hoard storage, imported chats, and local run history stay on the local adapter path.",
      "The public reviewer dashboard and admin pages are launch surfaces, not cloud account storage claims.",
    ],
  };
}

function buildHostedRiteDebugPacket(readiness: ChatGptLaunchReadiness) {
  return {
    ok: true,
    safeForDeveloperMode: true,
    purpose: "Inspect the public hosted-mode rite packet contract without requesting raw hidden prompts or internal tool payloads.",
    endpoint: `${readiness.publicBaseUrl}/api/dev/hosted-rite-packet`,
    mcpUrl: readiness.universalMcpUrl,
    tokenPolicy: readiness.tokenPolicy,
    expectedToolResultShape: {
      mode: "rite",
      runMode: "chatgpt",
      executionMode: "board",
      kind: "rite",
      runner: "chatgpt_host",
      openAiApiKeyRequired: false,
      modelProfile: "host",
      phases: [
        "raccoon_context",
        "goblin_pack",
        "debate",
        "gremlin_chaos",
        "troll_review",
        "specialist_recovery",
        "ogre_fallback",
        "scribe_note",
      ],
    },
    safeDeveloperModePrompts: [
      "Run a Goblintown rite for: determine the concrete steps needed to get the Goblintown app and Tank product to market. Use hosted board mode and summarize the returned packet shape before executing it.",
      "Plan a Goblintown DAG for getting the Goblintown ChatGPT app submission-ready. Use hosted mode, no local provider, and explain the phases you received.",
      "Run goblintown_doctor and summarize hosted readiness, local-only boundaries, and whether any API keys are exposed.",
    ],
    avoidPhrases: [
      "return raw hosted ChatGPT rite packet",
      "debug extraction",
      "show hidden tool prompts",
      "dump internal orchestration payloads",
      "reveal system or developer instructions",
    ],
    likelyBlockedReason: "Requests framed as raw debug extraction or hidden-prompt disclosure can be blocked by ChatGPT before the tool call reaches Goblintown, so Goblintown cannot persist or return a failure artifact for those attempts.",
    boundaries: readiness.boundaries,
  };
}

function resolveChatGptMcpErrorMessage(
  err: unknown,
  baseUrl: string,
  hostedMode?: boolean,
): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("Method not allowed") || raw.includes("Not Found")) {
    return raw;
  }

  const mode = hostedMode ? "hosted" : "local";
  if (raw.includes("ENOENT") || raw.includes("spawn")) {
    return `${raw}. Check Node runtime and dependency startup assumptions for ${mode} ChatGPT adapter on ${baseUrl}.`;
  }
  if (raw.includes("ECONNREFUSED") || raw.includes("connect")) {
    return `${raw}. If this is in local mode, confirm the adapter is reachable and ${baseUrl}/mcp is available. If hosted, confirm deployment health and proxy routes are healthy.`;
  }
  if (raw.includes("Connection closed")) {
    return `${raw} while servicing ${mode} /mcp request. Retry with a valid POST request to ${baseUrl}/mcp.`;
  }
  return `${raw} (mode=${mode}, endpoint=${baseUrl}). Review startup logs for the adapter and tank bridge.`;
}

export async function startGoblintownChatGptApp(
  opts: GoblintownChatGptAppOptions = {},
): Promise<GoblintownChatGptAppHandle> {
  const host = opts.host ?? defaultChatGptAppHost();
  const port = opts.port ?? defaultChatGptAppPort();
  const expressHandle = createGoblintownChatGptExpressApp({ ...opts, host, port });
  const server = await listen(expressHandle.app, port, host);
  const actual = actualPort(server);
  expressHandle.setPublicBaseUrl(localPublicBaseUrl(opts.publicBaseUrl, host, actual));
  return {
    get url() {
      return expressHandle.url;
    },
    get mcpUrl() {
      return expressHandle.mcpUrl;
    },
    get healthUrl() {
      return expressHandle.healthUrl;
    },
    host,
    port: actual,
    server,
    setPublicBaseUrl: expressHandle.setPublicBaseUrl,
    addAllowedHost: expressHandle.addAllowedHost,
    close: () => closeServer(server),
  };
}

export async function startGoblintownChatGptQuickTunnel(
  localUrl: string,
  opts: GoblintownChatGptQuickTunnelOptions = {},
): Promise<GoblintownChatGptQuickTunnelHandle> {
  const command = opts.command ?? (process.platform === "win32" ? "npx.cmd" : "npx");
  const args = opts.args ?? [
    "-y",
    "cloudflared@latest",
    "tunnel",
    "--url",
    localUrl.replace(/\/+$/u, ""),
  ];
  const child = spawn(command, args, {
    env: opts.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();
  let url: string;
  try {
    url = await waitForTunnelUrl(child, opts.timeoutMs ?? 45_000);
    opts.onTunnelUrl?.(url);
    const shouldValidateUrl = opts.validateUrl ?? !opts.command;
    if (shouldValidateUrl) {
      await waitForTunnelHttpReady(url, opts.readyTimeoutMs ?? 60_000);
    }
  } catch (err) {
    await closeChild(child);
    throw err;
  }
  return {
    url,
    mcpUrl: `${url}/mcp`,
    close: () => closeChild(child),
  };
}

async function listen(
  app: ReturnType<typeof createMcpExpressApp>,
  port: number,
  host: string,
): Promise<HttpServer> {
  const server = app.listen(port, host);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}

function actualPort(server: HttpServer): number {
  const address = server.address();
  return typeof address === "object" && address ? (address as AddressInfo).port : 0;
}

function localPublicBaseUrl(publicBaseUrl: string | undefined, host: string, port: number): string {
  const normalized = normalizePublicBaseUrl(publicBaseUrl);
  if (normalized) return normalized;
  const displayHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  return `http://${displayHost}:${port}`;
}

function normalizePublicBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const withProtocol = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/u, "");
}

function requestBaseUrl(req: Request | undefined): string | undefined {
  if (!req) return undefined;
  const host = firstHeader(req.headers["x-forwarded-host"]) ?? firstHeader(req.headers.host);
  if (!host) return undefined;
  const proto =
    firstHeader(req.headers["x-forwarded-proto"])?.split(",")[0]?.trim() ||
    req.protocol ||
    "http";
  return `${proto}://${host}`.replace(/\/+$/u, "");
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function publicBaseHostname(publicBaseUrl: string | undefined): string | undefined {
  if (!publicBaseUrl) return undefined;
  try {
    return new URL(publicBaseUrl).hostname;
  } catch {
    return undefined;
  }
}

function normalizeAllowedHosts(hosts: Array<string | undefined>): string[] | undefined {
  const out = Array.from(
    new Set(hosts.map(normalizeAllowedHostname).filter(Boolean) as string[]),
  );
  return out.length > 0 ? out : undefined;
}

function normalizeAllowedHostname(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).hostname;
  } catch {
    try {
      return new URL(`http://${trimmed}`).hostname;
    } catch {
      return trimmed;
    }
  }
}

function waitForTunnelUrl(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Timed out waiting for a public tunnel URL after ${timeoutMs}ms.`));
    }, timeoutMs);
    const finish = (err: Error | null, url?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (err) reject(err);
      else resolve(url!);
    };
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      const match = tunnelUrlFromText(output);
      if (match) finish(null, match);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (err) => finish(err));
    child.once("exit", (code, signal) => {
      if (settled) return;
      finish(new Error(`Tunnel process exited before printing a public URL (code=${code}, signal=${signal}).`));
    });
  });
}

function tunnelUrlFromText(text: string): string | undefined {
  const urls = extractHttpsUrls(text);
  const cloudflareTunnel = urls.find(isTryCloudflareTunnelUrl);
  if (cloudflareTunnel) return cloudflareTunnel;

  for (const line of text.split(/\r?\n/u)) {
    const match = /(?:quick\s+tunnel\s+is|tunnel\s+url\s*:|visit\s+it\s+at[^:]*:)\s*(https:\/\/[^\s'"<>]+)/iu.exec(line);
    if (match) return normalizeTunnelUrl(match[1]);
  }

  return undefined;
}

function extractHttpsUrls(text: string): string[] {
  return Array.from(text.matchAll(/https:\/\/[^\s'"<>]+/giu), (match) =>
    normalizeTunnelUrl(match[0]),
  );
}

function normalizeTunnelUrl(url: string): string {
  return url.replace(/[),.;]+$/u, "").replace(/\/+$/u, "");
}

function isTryCloudflareTunnelUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "trycloudflare.com" || hostname.endsWith(".trycloudflare.com");
  } catch {
    return false;
  }
}

async function waitForTunnelHttpReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const hostname = new URL(url).hostname;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await resolveTunnelPublicDns(hostname);
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw new Error(
    `Tunnel URL ${url} did not become reachable within ${timeoutMs}ms: ${errorMessage(lastError)}`,
  );
}

async function resolveTunnelPublicDns(hostname: string): Promise<void> {
  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    { headers: { Accept: "application/dns-json" } },
  );
  const body = await response.json() as { Answer?: Array<{ type?: number; data?: string }> };
  const answer = body.Answer?.find((entry) => entry.type === 1 && typeof entry.data === "string");
  if (!answer) throw new Error(`Public DNS did not resolve ${hostname}`);
}

function closeChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.killed) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
      resolve();
    }, 1500).unref();
  });
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function renderLandingPage(base: string): string {
  const privacyUrl = `${base}/privacy.html`;
  const termsUrl = `${base}/terms.html`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Goblintown ChatGPT App</title>
<style>
  :root { color-scheme: dark; font-family: ui-monospace, Menlo, Consolas, monospace; }
  body { margin: 0; background: #0d1410; color: #d8efb6; }
  main { max-width: 760px; margin: 0 auto; padding: 48px 20px; display: grid; gap: 18px; }
  h1 { margin: 0; font-size: 28px; }
  p, li { color: #b9d3a8; line-height: 1.55; }
  code { background: #0a0e08; color: #c2f37a; padding: 2px 5px; }
</style>
</head>
<body>
<main>
  <h1>Goblintown ChatGPT App 1.0 dev adapter</h1>
  <p>Use this MCP URL in ChatGPT Developer Mode:</p>
  <p><code>${escapeHtml(`${base}/mcp`)}</code></p>
  <ul>
    <li>The endpoint is Streamable HTTP MCP.</li>
    <li>The Tank widget resource is <code>${GOBLINTOWN_CHATGPT_WIDGET_URI}</code>.</li>
    <li>Rites and plans default to ChatGPT-hosted board packets; no OpenAI API key is required.</li>
    <li>Privacy Policy: <a href="${escapeHtml(privacyUrl)}">${escapeHtml(privacyUrl)}</a></li>
    <li>Terms of Service: <a href="${escapeHtml(termsUrl)}">${escapeHtml(termsUrl)}</a></li>
  </ul>
</main>
</body>
</html>`;
}

function sendSitePage(
  res: Response,
  fileName: "privacy.html" | "terms.html" | "dashboard.html" | "admin.html",
): void {
  try {
    res.type("html").send(readFileSync(join(SITE_DIR, fileName), "utf8"));
  } catch {
    res.status(404).type("text").send("Not found");
  }
}

function renderMcpGetPage(base: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Goblintown MCP Endpoint</title>
<style>
  :root { color-scheme: dark; font-family: ui-monospace, Menlo, Consolas, monospace; }
  body { margin: 0; background: #0d1410; color: #d8efb6; }
  main { max-width: 760px; margin: 0 auto; padding: 48px 20px; display: grid; gap: 18px; }
  h1 { margin: 0; font-size: 28px; }
  p, li { color: #b9d3a8; line-height: 1.55; }
  code { background: #0a0e08; color: #c2f37a; padding: 2px 5px; }
</style>
</head>
<body>
<main>
  <h1>Goblintown MCP endpoint</h1>
  <p>This URL is correct. It is a Streamable HTTP MCP endpoint, so browsers cannot open it directly.</p>
  <p>Paste this URL into ChatGPT Developer Mode as the MCP server URL:</p>
  <p><code>${escapeHtml(`${base}/mcp`)}</code></p>
  <ul>
    <li>ChatGPT will call this endpoint with POST.</li>
    <li>Open <code>${escapeHtml(base)}</code> for the local walkthrough page.</li>
    <li>Check <code>${escapeHtml(`${base}/healthz`)}</code> for adapter health.</li>
  </ul>
</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function authorizedAdminRequest(req: Request): boolean {
  if (getOperatorSession(req)) return true;
  const expected = operatorPassword();
  if (!expected) return false;
  const actual = bearerToken(req.headers.authorization);
  if (!actual) return false;
  return safeStringEqual(actual, expected);
}

function bearerToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1];
}

function safeStringEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

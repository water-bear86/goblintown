import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

const GH_WEB_BASE = "https://github.com";
const GH_API_BASE = "https://api.github.com";
const SESSION_COOKIE = "goblintown_operator_session";
const STATE_COOKIE = "goblintown_operator_state";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface OperatorSession {
  login: string;
  name?: string;
  avatarUrl?: string;
  expiresAt: number;
}

interface SessionPayload extends OperatorSession {
  v: 1;
}

interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  allowedLogins: Set<string>;
}

export function githubOperatorAuthConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !!githubOAuthConfig(env);
}

export function getOperatorSession(
  req: Request,
  env: Record<string, string | undefined> = process.env,
): OperatorSession | undefined {
  const config = githubOAuthConfig(env);
  if (!config) return undefined;
  const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!cookie) return undefined;
  const payload = verifySignedJson<SessionPayload>(cookie, config.sessionSecret);
  if (!payload || payload.v !== 1 || typeof payload.login !== "string") return undefined;
  if (payload.expiresAt <= Date.now()) return undefined;
  return {
    login: payload.login,
    name: payload.name,
    avatarUrl: payload.avatarUrl,
    expiresAt: payload.expiresAt,
  };
}

export function startGithubOperatorLogin(req: Request, res: Response, baseUrl: string): void {
  const config = githubOAuthConfig();
  if (!config) {
    res.status(400).json({ ok: false, error: "github_operator_auth_not_configured" });
    return;
  }
  const state = randomBytes(24).toString("base64url");
  const returnTo = safeReturnTo(req.query.returnTo);
  const signedState = signJson({ state, returnTo, createdAt: Date.now() }, config.sessionSecret);
  setCookie(res, STATE_COOKIE, signedState, {
    httpOnly: true,
    secure: baseUrl.startsWith("https://"),
    maxAgeSeconds: 600,
  });
  const authorizeUrl = new URL("/login/oauth/authorize", GH_WEB_BASE);
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", `${baseUrl}/api/admin/auth/github/callback`);
  authorizeUrl.searchParams.set("scope", "read:user");
  authorizeUrl.searchParams.set("state", state);
  res.redirect(authorizeUrl.toString());
}

export async function completeGithubOperatorLogin(
  req: Request,
  res: Response,
  baseUrl: string,
): Promise<void> {
  const config = githubOAuthConfig();
  if (!config) {
    res.status(400).json({ ok: false, error: "github_operator_auth_not_configured" });
    return;
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const stateCookie = parseCookies(req.headers.cookie)[STATE_COOKIE];
  const statePayload = stateCookie
    ? verifySignedJson<{ state?: unknown; returnTo?: unknown }>(stateCookie, config.sessionSecret)
    : undefined;
  clearCookie(res, STATE_COOKIE);
  if (!code || !state || statePayload?.state !== state) {
    res.status(400).send("Invalid login state.");
    return;
  }

  const accessToken = await exchangeCodeForToken(config, code, baseUrl);
  const user = await fetchGithubUser(accessToken);
  if (!isAllowedOperator(user.login, config)) {
    res.status(403).send("GitHub user is not allowed for this operator console.");
    return;
  }

  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const session = signJson<SessionPayload>(
    {
      v: 1,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl,
      expiresAt,
    },
    config.sessionSecret,
  );
  setCookie(res, SESSION_COOKIE, session, {
    httpOnly: true,
    secure: baseUrl.startsWith("https://"),
    maxAgeSeconds: SESSION_TTL_SECONDS,
  });
  res.redirect(safeReturnTo(statePayload.returnTo));
}

export function clearOperatorSession(res: Response): void {
  clearCookie(res, SESSION_COOKIE);
}

function githubOAuthConfig(
  env: Record<string, string | undefined> = process.env,
): GitHubOAuthConfig | undefined {
  const clientId = env.GITHUB_APP_CLIENT_ID ?? env.OPERATOR_GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET ?? env.OPERATOR_GITHUB_CLIENT_SECRET;
  const sessionSecret = env.OPERATOR_SESSION_SECRET ?? env.AGENT_DUTY_SESSION_SECRET;
  if (!clientId || !clientSecret || !sessionSecret) return undefined;
  return {
    clientId,
    clientSecret,
    sessionSecret,
    allowedLogins: allowedLogins(env),
  };
}

function allowedLogins(env: Record<string, string | undefined>): Set<string> {
  return new Set(
    (env.OPERATOR_ALLOWED_GITHUB_LOGINS ?? env.AGENT_DUTY_ADMINS ?? "")
      .split(",")
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isAllowedOperator(login: string, config: GitHubOAuthConfig): boolean {
  return config.allowedLogins.size > 0 && config.allowedLogins.has(login.toLowerCase());
}

async function exchangeCodeForToken(
  config: GitHubOAuthConfig,
  code: string,
  baseUrl: string,
): Promise<string> {
  const response = await fetch(`${GH_WEB_BASE}/login/oauth/access_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "goblintown-operator-auth",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: `${baseUrl}/api/admin/auth/github/callback`,
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub OAuth token exchange failed: ${response.status}`);
  }
  const body = (await response.json()) as { access_token?: unknown; error?: unknown };
  if (typeof body.access_token !== "string" || body.access_token.length === 0) {
    throw new Error(`GitHub OAuth token exchange failed: ${String(body.error ?? "missing token")}`);
  }
  return body.access_token;
}

async function fetchGithubUser(token: string): Promise<{
  login: string;
  name?: string;
  avatarUrl?: string;
}> {
  const response = await fetch(`${GH_API_BASE}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "goblintown-operator-auth",
    },
  });
  if (!response.ok) throw new Error(`GitHub user lookup failed: ${response.status}`);
  const body = (await response.json()) as {
    login?: unknown;
    name?: unknown;
    avatar_url?: unknown;
  };
  if (typeof body.login !== "string" || body.login.length === 0) {
    throw new Error("GitHub user lookup did not include a login");
  }
  return {
    login: body.login,
    name: typeof body.name === "string" ? body.name : undefined,
    avatarUrl: typeof body.avatar_url === "string" ? body.avatar_url : undefined,
  };
}

function signJson<T>(value: T, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = hmac(payload, secret);
  return `${payload}.${signature}`;
}

function verifySignedJson<T>(value: string, secret: string): T | undefined {
  const [payload, signature, ...extra] = value.split(".");
  if (!payload || !signature || extra.length > 0) return undefined;
  if (!safeEqual(signature, hmac(payload, secret))) return undefined;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  } catch {
    return undefined;
  }
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

function parseCookies(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function setCookie(
  res: Response,
  name: string,
  value: string,
  opts: { httpOnly: boolean; secure: boolean; maxAgeSeconds: number },
): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${opts.maxAgeSeconds}`,
  ];
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function clearCookie(res: Response, name: string): void {
  res.append("Set-Cookie", `${name}=; Path=/; SameSite=Lax; Max-Age=0; HttpOnly`);
}

function safeReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "/admin.html";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/admin.html";
  if (raw.includes("\n") || raw.includes("\r")) return "/admin.html";
  return raw;
}

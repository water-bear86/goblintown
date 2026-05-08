import {
  CREATURE_KINDS,
  type CountryConfig,
  type CreatureKind,
  type OutputFormat,
  type Personality,
  type WarrenPeer,
} from "./types.js";

export const MAX_TEAM_MEMBERS = 6;
export const MAX_PEERS = MAX_TEAM_MEMBERS - 1;

export interface CountryDispatchRequest {
  task: string;
  packSize: number;
  scanGlobs: string[];
  personality?: Personality;
  budgetTokens?: number;
  maxOutputTokens?: number;
  outputFormat?: OutputFormat;
}

export interface CountryDispatchResult {
  peer: WarrenPeer;
  runId: string;
  done: boolean;
  outcome?: string;
  finalRiteId?: string;
  error?: string;
}

interface RemoteRunRecord {
  done: boolean;
  outcome?: string;
  finalRiteId?: string;
  error?: string;
}

export function normalizeWarrenPeers(value: unknown): WarrenPeer[] {
  if (!Array.isArray(value)) return [];
  const out: WarrenPeer[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const peer = normalizeWarrenPeer(item);
    if (!peer) continue;
    const key = peer.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(peer);
  }
  return out.slice(0, MAX_PEERS);
}

export function normalizeWarrenPeer(value: unknown): WarrenPeer | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const name = normalizeName(input.name);
  const url = normalizeUrl(input.url);
  if (!name || !url) return null;
  const createdAt =
    typeof input.createdAt === "string" && input.createdAt.length > 0
      ? input.createdAt
      : new Date().toISOString();
  const note = typeof input.note === "string" ? input.note.trim() : undefined;
  return { name, url, createdAt, ...(note ? { note } : {}) };
}

export function normalizeCountryConfig(value: unknown): CountryConfig {
  const input =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const roleOwners = normalizeRoleOwners(input.roleOwners);
  return {
    roleOwners,
    autoAssignLeadExtras: input.autoAssignLeadExtras !== false,
  };
}

export function resolveRoleOwners(
  cfg: CountryConfig | undefined,
  memberNames: string[],
  leadName: string,
): Record<CreatureKind, string> {
  const config = normalizeCountryConfig(cfg);
  const allowed = new Set(memberNames.map((m) => m.toLowerCase()));
  const lead = allowed.has(leadName.toLowerCase()) ? leadName : memberNames[0] || leadName;
  const out = {} as Record<CreatureKind, string>;
  for (const role of CREATURE_KINDS) {
    const raw = config.roleOwners?.[role];
    if (raw && allowed.has(raw.toLowerCase())) {
      out[role] = memberNames.find((m) => m.toLowerCase() === raw.toLowerCase()) || lead;
      continue;
    }
    out[role] = config.autoAssignLeadExtras === false ? "" : lead;
  }
  return out;
}

export function selectPeers(
  peers: WarrenPeer[],
  refs: string[] = [],
): { selected: WarrenPeer[]; missing: string[] } {
  if (refs.length === 0) return { selected: peers, missing: [] };
  const byName = new Map(peers.map((p) => [p.name.toLowerCase(), p] as const));
  const byUrl = new Map(peers.map((p) => [p.url, p] as const));
  const selected: WarrenPeer[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const raw of refs) {
    const ref = raw.trim();
    if (!ref) continue;
    const normalizedUrl = normalizeUrl(ref);
    const found =
      byName.get(ref.toLowerCase()) ||
      (normalizedUrl ? byUrl.get(normalizedUrl) : undefined);
    if (!found) {
      missing.push(raw);
      continue;
    }
    if (seen.has(found.name.toLowerCase())) continue;
    seen.add(found.name.toLowerCase());
    selected.push(found);
  }
  return { selected, missing };
}

export async function dispatchRiteToPeer(
  peer: WarrenPeer,
  req: CountryDispatchRequest,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<CountryDispatchResult> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const pollMs = opts.pollMs ?? 1_000;
  const start = await fetch(`${peer.url}/api/rite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: req.task,
      packSize: req.packSize,
      scanGlobs: req.scanGlobs,
      personality: req.personality,
      budgetTokens: req.budgetTokens,
      maxOutputTokens: req.maxOutputTokens,
      outputFormat: req.outputFormat,
    }),
  });
  if (!start.ok) {
    const body = await start.text().catch(() => "");
    throw new Error(
      `${peer.name}: start failed (${start.status} ${start.statusText}) ${truncate(body, 140)}`,
    );
  }
  const startBody = (await start.json()) as { runId?: string };
  if (!startBody.runId) {
    throw new Error(`${peer.name}: start response missing runId`);
  }
  const runId = startBody.runId;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${peer.url}/api/runs/${runId}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `${peer.name}: polling failed (${res.status} ${res.statusText}) ${truncate(body, 140)}`,
      );
    }
    const run = (await res.json()) as RemoteRunRecord;
    if (run.done) {
      return {
        peer,
        runId,
        done: true,
        outcome: run.outcome,
        finalRiteId: run.finalRiteId,
        error: run.error,
      };
    }
    await sleep(pollMs);
  }
  throw new Error(`${peer.name}: timeout waiting for run ${runId}`);
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name)) return null;
  return name;
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw.length === 0) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeRoleOwners(value: unknown): Partial<Record<CreatureKind, string>> {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const out: Partial<Record<CreatureKind, string>> = {};
  for (const role of CREATURE_KINDS) {
    const owner = typeof input[role] === "string" ? input[role].trim() : "";
    if (owner) out[role] = owner;
  }
  return out;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

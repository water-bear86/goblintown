import { githubApiToken } from "./github-app.js";

const DEFAULT_OWNER = "goblintownlol";
const DEFAULT_REPO = "chatgptapp";
const DEFAULT_AGENTS = ["you", "codex", "hermes"];
const DEFAULT_VARIABLE = "AGENT_DUTY_STATE";
const GH_API_BASE = "https://api.github.com";
const GH_API_VERSION = "2022-11-28";

export interface AgentDutyEntry {
  id: string;
  label: string;
  onDuty: boolean;
}

export interface AgentDutyState {
  agents: AgentDutyEntry[];
  source: "github-variable" | "env" | "memory";
  variableName?: string;
  repo?: string;
  updatedAt?: string;
}

interface DutyRecord {
  agents?: Record<string, boolean>;
  updatedAt?: string;
}

interface GitHubVariableConfig {
  owner: string;
  repo: string;
  token: string;
  variableName: string;
}

const memoryDuty = new Map<string, boolean>();
let memoryUpdatedAt: string | undefined;

export function configuredDutyAgents(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return normalizeAgentList(env.AGENT_DUTY_AGENTS ?? env.DISPATCH_AGENTS, DEFAULT_AGENTS);
}

export function operatorPasswordConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !!operatorPassword(env);
}

export function operatorPassword(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const value =
    env.AGENT_DUTY_PASSWORD ??
    env.OPERATOR_ADMIN_PASSWORD ??
    env.ADMIN_PASSWORD;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function loadAgentDutyState(
  env: Record<string, string | undefined> = process.env,
): Promise<AgentDutyState> {
  const agents = configuredDutyAgents(env);
  const github = await githubVariableConfig(env);
  if (github) {
    const raw = await readGithubVariable(github);
    if (raw !== undefined) {
      return renderDutyState(parseDutyRecord(raw), agents, {
        source: "github-variable",
        repo: `${github.owner}/${github.repo}`,
        variableName: github.variableName,
      });
    }
  }

  const envState = env.AGENT_DUTY_STATE;
  if (envState) {
    return renderDutyState(parseDutyRecord(envState), agents, { source: "env" });
  }

  return renderDutyState(memoryRecord(), agents, { source: "memory" });
}

export async function setAgentDuty(
  agent: string,
  onDuty: boolean,
  env: Record<string, string | undefined> = process.env,
): Promise<AgentDutyState> {
  const agents = configuredDutyAgents(env);
  if (!agents.includes(agent)) {
    throw new Error(`Unknown agent: ${agent}`);
  }

  const current = await loadAgentDutyState(env);
  const nextRecord: DutyRecord = {
    agents: Object.fromEntries(current.agents.map((entry) => [entry.id, entry.onDuty])),
    updatedAt: new Date().toISOString(),
  };
  nextRecord.agents![agent] = onDuty;

  const github = await githubVariableConfig(env);
  if (github) {
    await writeGithubVariable(github, JSON.stringify(nextRecord));
    return renderDutyState(nextRecord, agents, {
      source: "github-variable",
      repo: `${github.owner}/${github.repo}`,
      variableName: github.variableName,
    });
  }

  memoryDuty.clear();
  for (const [id, value] of Object.entries(nextRecord.agents ?? {})) {
    memoryDuty.set(id, value);
  }
  memoryUpdatedAt = nextRecord.updatedAt;
  return renderDutyState(nextRecord, agents, { source: "memory" });
}

export async function onDutyAgents(
  agents: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<string[]> {
  const state = await loadAgentDutyState({
    ...env,
    AGENT_DUTY_AGENTS: agents.join(","),
  });
  return state.agents.filter((agent) => agent.onDuty).map((agent) => agent.id);
}

function normalizeAgentList(raw: string | undefined, fallback: string[]): string[] {
  const parsed = raw
    ?.split(",")
    .map((agent) => agent.trim())
    .filter(Boolean);
  const source = parsed && parsed.length > 0 ? parsed : fallback;
  return [...new Set(source)];
}

function parseDutyRecord(raw: string): DutyRecord {
  try {
    const parsed = JSON.parse(raw) as DutyRecord;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function memoryRecord(): DutyRecord {
  return {
    agents: Object.fromEntries(memoryDuty),
    updatedAt: memoryUpdatedAt,
  };
}

function renderDutyState(
  record: DutyRecord,
  agents: string[],
  meta: Omit<AgentDutyState, "agents">,
): AgentDutyState {
  return {
    ...meta,
    updatedAt: record.updatedAt,
    agents: agents.map((id) => ({
      id,
      label: labelForAgent(id),
      onDuty: record.agents?.[id] !== false,
    })),
  };
}

function labelForAgent(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

async function githubVariableConfig(
  env: Record<string, string | undefined>,
): Promise<GitHubVariableConfig | undefined> {
  const token = await githubApiToken(env);
  if (!token) return undefined;
  return {
    owner: env.AGENT_DUTY_OWNER ?? env.DISPATCH_OWNER ?? DEFAULT_OWNER,
    repo: env.AGENT_DUTY_REPO ?? env.DISPATCH_REPO ?? DEFAULT_REPO,
    token,
    variableName: env.AGENT_DUTY_VARIABLE ?? DEFAULT_VARIABLE,
  };
}

async function readGithubVariable(config: GitHubVariableConfig): Promise<string | undefined> {
  const response = await fetch(
    `${GH_API_BASE}/repos/${config.owner}/${config.repo}/actions/variables/${config.variableName}`,
    { method: "GET", headers: githubHeaders(config.token) },
  );
  if (response.status === 404) return undefined;
  if (!response.ok) throw await githubError(response);
  const body = (await response.json()) as { value?: unknown };
  return typeof body.value === "string" ? body.value : undefined;
}

async function writeGithubVariable(config: GitHubVariableConfig, value: string): Promise<void> {
  const existing = await readGithubVariable(config);
  const url =
    existing === undefined
      ? `${GH_API_BASE}/repos/${config.owner}/${config.repo}/actions/variables`
      : `${GH_API_BASE}/repos/${config.owner}/${config.repo}/actions/variables/${config.variableName}`;
  const response = await fetch(url, {
    method: existing === undefined ? "POST" : "PATCH",
    headers: {
      ...githubHeaders(config.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: config.variableName, value }),
  });
  if (!response.ok) throw await githubError(response);
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GH_API_VERSION,
    "User-Agent": "goblintown-agent-duty",
  };
}

async function githubError(response: Response): Promise<Error> {
  const text = await response.text();
  return new Error(`GitHub variable request failed: ${response.status} ${text.slice(0, 300)}`);
}

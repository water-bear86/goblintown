import { randomUUID } from "node:crypto";
import { onDutyAgents } from "./agent-duty.js";
import { githubApiToken } from "./github-app.js";

const DEFAULT_OWNER = "goblintownlol";
const DEFAULT_REPO = "chatgptapp";
const DEFAULT_LABEL = "job";
const DEFAULT_AGENTS = ["you", "codex", "hermes"];
const HERMES_AGENT = "hermes";
const HERMES_ALLOWED_PHASES = new Set(["phase-4"]);
const GH_API_BASE = "https://api.github.com";
const GH_API_VERSION = "2022-11-28";
const PAGE_SIZE = 100;

const PHASE_PRIORITY: Record<string, number> = {
  "phase-1": 10,
  "phase-2": 8,
  "phase-3": 6,
  "phase-4": 4,
};

const DEPENDENCY_MAP: Record<string, string[]> = {
  "AUTH-1": [],
  "AUTH-2": [],
  "AUTH-3": ["AUTH-1", "AUTH-2"],
  "UI-1": ["AUTH-1"],
  "DAG-1": ["AUTH-3", "UI-1"],
  "DAG-2": ["AUTH-2"],
  "DAG-3": ["DAG-1", "DAG-2"],
  "DAG-4": ["DAG-2"],
  "ADMIN-1": ["AUTH-3"],
  "ADMIN-2": ["AUTH-3"],
  "ADMIN-3": ["AUTH-3"],
  "ADMIN-4": ["AUTH-3"],
  "DEPLOY-1": [
    "AUTH-1",
    "AUTH-2",
    "AUTH-3",
    "UI-1",
    "DAG-1",
    "DAG-2",
    "DAG-3",
    "DAG-4",
    "ADMIN-1",
    "ADMIN-2",
    "ADMIN-3",
    "ADMIN-4",
  ],
  "DEPLOY-2": ["DEPLOY-1"],
  "DEPLOY-3": ["DEPLOY-1", "DEPLOY-2"],
};

interface GitHubIssue {
  number: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  labels: Array<{ name?: string }>;
  assignees: Array<{ login?: string }>;
}

interface DispatchTarget {
  owner: string;
  repo: string;
  full: string;
}

function uniqueTargets(entries: DispatchTarget[]): DispatchTarget[] {
  const seen = new Set<string>();
  const out: DispatchTarget[] = [];
  for (const entry of entries) {
    if (seen.has(entry.full)) continue;
    seen.add(entry.full);
    out.push(entry);
  }
  return out;
}

interface EnrichedIssue extends GitHubIssue {
  owner: string;
  repo: string;
  full: string;
}

interface RepoSummary {
  repo: string;
  open: number;
  closed: number;
  assigned: number;
  skipped: number;
}

interface DispatchIssue {
  repo: string;
  issueNumber: number;
  title: string;
  taskId: string;
  phase: string;
  priority: number;
  assignedTo: string;
}

interface DispatchSkip {
  repo: string;
  issueNumber: number;
  reason: string;
}

interface DispatchError {
  repo: string;
  issueNumber: number;
  message: string;
}

export interface DispatchSummary {
  runId: string;
  owner: string;
  repo: string;
  label: string;
  targets?: string[];
  repoSummaries?: RepoSummary[];
  scannedOpen: number;
  assigned: number;
  skipped: number;
  errors: number;
  dispatched: DispatchIssue[];
  skippedIssues: DispatchSkip[];
  errorIssues: DispatchError[];
}

interface OctokitHeaders {
  [key: string]: string;
}

function githubHeaders(token: string): OctokitHeaders {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GH_API_VERSION,
    "User-Agent": "goblintown-orchestrator",
  };
}

function parseIssueTaskId(title: string, body?: string | null): string | undefined {
  const bracketMatch = /\[([A-Z]+-\d+)\]/.exec(title);
  if (bracketMatch?.[1]) return bracketMatch[1];
  const inlineMatch = /\b([A-Z]+-\d+)\b/.exec(title);
  if (inlineMatch?.[1]) return inlineMatch[1];

  if (!body) return;
  const bodyBracketMatch = /\[([A-Z]+-\d+)\]/.exec(body);
  if (bodyBracketMatch?.[1]) return bodyBracketMatch[1];
  const bodyInlineMatch = /\b([A-Z]+-\d+)\b/.exec(body);
  return bodyInlineMatch?.[1];
}

function extractPhase(labels: Array<{ name?: string }>): string {
  const explicit = labels
    .map((label) => label.name)
    .find((name): name is string => !!name && name.startsWith("phase-"));
  return explicit ?? "phase-1";
}

function pickAgents(): string[] {
  const envAgents = process.env.DISPATCH_AGENTS
    ?.split(",")
    .map((agent) => agent.trim())
    .filter(Boolean);
  return envAgents && envAgents.length > 0 ? envAgents : DEFAULT_AGENTS;
}

function resolveDispatchTargets(): DispatchTarget[] {
  const owner = process.env.DISPATCH_OWNER ?? DEFAULT_OWNER;
  const repo = process.env.DISPATCH_REPO ?? DEFAULT_REPO;
  const targets = process.env.DISPATCH_TARGETS;

  if (targets === undefined) {
    return [{ owner, repo, full: `${owner}/${repo}` }];
  }
  const normalizedTargets = targets.trim();
  if (!normalizedTargets) {
    throw new Error("DISPATCH_TARGETS is set but empty. Remove it for fallback mode or provide owner/repo values.");
  }

  const parsed = targets
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [entryOwner, entryRepo, ...extras] = entry.split("/");
      if (!entryOwner || !entryRepo || extras.length > 0) {
        throw new Error(`Invalid DISPATCH_TARGETS entry: ${entry}`);
      }
      return {
        owner: entryOwner,
        repo: entryRepo,
        full: `${entryOwner}/${entryRepo}`,
      };
    });

  if (parsed.length === 0) {
    throw new Error("DISPATCH_TARGETS was set but did not contain any owner/repo values");
  }

  return uniqueTargets(parsed);
}

function parseNextPage(linkHeader: string | null): number | null {
  if (!linkHeader) return null;
  const match = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
  if (!match?.[1]) return null;
  try {
    const nextUrl = new URL(match[1]);
    const next = nextUrl.searchParams.get("page");
    if (!next) return null;
    const nextPage = Number.parseInt(next, 10);
    return Number.isFinite(nextPage) && nextPage > 0 ? nextPage : null;
  } catch {
    return null;
  }
}

async function ghRequest<T>(
  path: string,
  token: string,
  init: RequestInit = {},
  searchParams: Record<string, string> = {},
): Promise<{ data: T; headers: Headers }> {
  const url = new URL(`${GH_API_BASE}${path}`);
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      ...githubHeaders(token),
      ...(init.headers ? Object.fromEntries(new Headers(init.headers as HeadersInit) as Headers) : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub request failed: ${response.status} ${response.statusText} ${text.slice(0, 300)}`
    );
  }

  const maybeJson = response.headers.get("content-type")?.includes("application/json");
  const data = (maybeJson ? await response.json() : null) as T;
  return { data, headers: response.headers };
}

async function listIssues(
  owner: string,
  repo: string,
  state: "open" | "closed",
  label: string,
  token: string,
): Promise<GitHubIssue[]> {
  const issues: GitHubIssue[] = [];
  let page = 1;

  while (true) {
    const { data, headers } = await ghRequest<GitHubIssue[]>(
      `/repos/${owner}/${repo}/issues`,
      token,
      {
        method: "GET",
      },
      {
        state,
        labels: label,
        per_page: String(PAGE_SIZE),
        page: String(page),
      },
    );
    issues.push(...data);
    const next = parseNextPage(headers.get("link"));
    if (!next) break;
    page = next;
  }

  return issues;
}

async function addAssignee(
  owner: string,
  repo: string,
  issueNumber: number,
  assignee: string,
  token: string,
): Promise<void> {
  await ghRequest<void>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/assignees`,
    token,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ assignees: [assignee] }),
    },
  );
}

function getIssueDependencies(taskId: string): string[] {
  return DEPENDENCY_MAP[taskId] ?? [];
}

function assignPriority(phase: string): number {
  return PHASE_PRIORITY[phase] ?? PHASE_PRIORITY["phase-1"];
}

function buildAgentLoad(agents: string[], openIssues: EnrichedIssue[]): Map<string, number> {
  const loads = new Map<string, number>();
  for (const agent of agents) loads.set(agent, 0);

  for (const issue of openIssues) {
    const assignees = new Set(issue.assignees.map((assignee) => assignee.login).filter(Boolean) as string[]);
    for (const assignee of assignees) {
      const current = loads.get(assignee);
      if (current === undefined) continue;
      loads.set(assignee, current + 1);
    }
  }

  return loads;
}

function getEligibleAgents(agents: string[], phase: string): string[] {
  return agents.filter((agent) => {
    if (agent === HERMES_AGENT) {
      return HERMES_ALLOWED_PHASES.has(phase);
    }
    return true;
  });
}

function pickLeastBusyAgent(loads: Map<string, number>, agents: string[]): string {
  let selected: string | undefined;
  const allowed = new Set(agents);
  for (const [agent, count] of loads.entries()) {
    if (!allowed.has(agent)) {
      continue;
    }
    if (!selected) {
      selected = agent;
      continue;
    }
    const selectedCount = loads.get(selected) ?? Number.MAX_SAFE_INTEGER;
    if (count < selectedCount || (count === selectedCount && agent < selected)) {
      selected = agent;
    }
  }
  if (!selected) {
    throw new Error("No eligible agents available for assignment");
  }
  return selected;
}

export async function dispatchTasks(): Promise<DispatchSummary> {
  const targets = resolveDispatchTargets();
  const label = process.env.DISPATCH_LABEL ?? DEFAULT_LABEL;
  const token = await githubApiToken();
  if (!token) {
    throw new Error("Missing GitHub API token. Configure GITHUB_TOKEN or GitHub App installation credentials.");
  }

  const agents = await onDutyAgents(pickAgents());
  const runId = randomUUID();
  const primaryTarget = targets[0] ?? {
    owner: process.env.DISPATCH_OWNER ?? DEFAULT_OWNER,
    repo: process.env.DISPATCH_REPO ?? DEFAULT_REPO,
    full: `${process.env.DISPATCH_OWNER ?? DEFAULT_OWNER}/${process.env.DISPATCH_REPO ?? DEFAULT_REPO}`,
  };

  const openIssues: EnrichedIssue[] = [];
  const closedIssues: EnrichedIssue[] = [];
  const repoSummaries: RepoSummary[] = [];
  for (const target of targets) {
    const open = await listIssues(target.owner, target.repo, "open", label, token);
    const closed = await listIssues(target.owner, target.repo, "closed", label, token);

    repoSummaries.push({
      repo: target.full,
      open: open.length,
      closed: closed.length,
      assigned: 0,
      skipped: 0,
    });

    openIssues.push(
      ...open.map((issue) => ({
        ...issue,
        owner: target.owner,
        repo: target.repo,
        full: target.full,
      })),
    );
    closedIssues.push(
      ...closed.map((issue) => ({
        ...issue,
        owner: target.owner,
        repo: target.repo,
        full: target.full,
      })),
    );
  }

  const doneTaskIds = new Set(
    closedIssues
      .map((issue) => parseIssueTaskId(issue.title, issue.body))
      .filter((id): id is string => !!id),
  );

  const loads = buildAgentLoad(agents, openIssues);
  const dispatched: DispatchIssue[] = [];
  const skippedIssues: DispatchSkip[] = [];
  const errorIssues: DispatchError[] = [];
  const repoSummaryByRepo = new Map(repoSummaries.map((summary) => [summary.repo, summary]));

  const pushSkipped = (issue: EnrichedIssue, reason: string): void => {
    skippedIssues.push({
      repo: issue.full,
      issueNumber: issue.number,
      reason,
    });
    const summary = repoSummaryByRepo.get(issue.full);
    if (summary) summary.skipped += 1;
  };

  for (const issue of openIssues) {
    if (issue.assignees.length > 0) {
      pushSkipped(issue, "already assigned");
      continue;
    }

    const taskId = parseIssueTaskId(issue.title, issue.body);
    if (!taskId) {
      pushSkipped(issue, "unparseable task id");
      continue;
    }

    const dependencies = getIssueDependencies(taskId);
    const missingDependencies = dependencies.filter((dep) => !doneTaskIds.has(dep));
    if (missingDependencies.length > 0) {
      pushSkipped(issue, `waiting for dependencies: ${missingDependencies.join(", ")}`);
      continue;
    }

    const phase = extractPhase(issue.labels);
    const eligibleAgents = getEligibleAgents(agents, phase);
    if (eligibleAgents.length === 0) {
      pushSkipped(issue, `no eligible agents for phase ${phase}`);
      continue;
    }

    let assignee: string;
    try {
      assignee = pickLeastBusyAgent(loads, eligibleAgents);
      await addAssignee(issue.owner, issue.repo, issue.number, assignee, token);
    } catch (err) {
      errorIssues.push({
        repo: issue.full,
        issueNumber: issue.number,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    loads.set(assignee, (loads.get(assignee) ?? 0) + 1);
    const summary = repoSummaryByRepo.get(issue.full);
    if (summary) summary.assigned += 1;

    const priority = assignPriority(phase);
    dispatched.push({
      repo: issue.full,
      issueNumber: issue.number,
      title: issue.title,
      taskId,
      phase,
      priority,
      assignedTo: assignee,
    });
  }

  return {
    runId,
    owner: primaryTarget.owner,
    repo: primaryTarget.repo,
    label,
    targets: targets.map((target) => target.full),
    repoSummaries,
    scannedOpen: openIssues.length,
    assigned: dispatched.length,
    skipped: skippedIssues.length,
    errors: errorIssues.length,
    dispatched,
    skippedIssues,
    errorIssues,
  };
}

export function describeDispatchedIssue(dispatch: DispatchIssue): string {
  return `#${dispatch.issueNumber} ${dispatch.taskId} (${dispatch.repo}) -> ${dispatch.assignedTo} (priority ${dispatch.priority})`;
}

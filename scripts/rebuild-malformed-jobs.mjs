#!/usr/bin/env node

const OWNER = process.env.DISPATCH_OWNER ?? "goblintownlol";
const REPO = process.env.DISPATCH_REPO ?? "chatgptapp";
const LABEL = process.env.DISPATCH_LABEL ?? "job";
const GH_API_BASE = "https://api.github.com";
const GH_API_VERSION = "2022-11-28";
const PAGE_SIZE = 100;
const DEFAULT_SUMMARY_LIMIT = 110;

const args = parseArgs(process.argv.slice(2));
const options = {
  owner: args["owner"] ?? OWNER,
  repo: args["repo"] ?? REPO,
  label: args["label"] ?? LABEL,
  issueNumbers: (args["issues"] ?? "").split(",").map((value) => Number.parseInt(value, 10)).filter((value) => Number.isFinite(value)),
  apply: args["apply"] === "true" || process.argv.includes("--apply"),
  limit: Number.parseInt(args["limit"] ?? "0", 10),
  summaryLimit: Number.parseInt(args["summary-limit"] ?? String(DEFAULT_SUMMARY_LIMIT), 10),
};

const token = process.env.GITHUB_TOKEN;
if (!token) {
  throw new Error("Missing GITHUB_TOKEN");
}

if (!options.label) {
  throw new Error("--label is required");
}

if (!options.owner || !options.repo) {
  throw new Error("--owner and --repo are required");
}

const issues = options.issueNumbers.length > 0
  ? await fetchIssuesByNumber(options.owner, options.repo, options.issueNumbers, token)
  : await listOpenLabeledIssues(options.owner, options.repo, options.label, token);

if (options.limit > 0 && issues.length > options.limit) {
  issues.length = options.limit;
}

const planned = [];
for (const issue of issues) {
  const currentTitle = issue.title ?? "";
  const taskId = parseTaskId(currentTitle) ?? parseTaskId(issue.body ?? "");
  if (!taskId) {
    continue;
  }

  const summary = pickSummary(issue.body ?? "");
  const newTitle = buildCanonicalTitle(taskId, summary, currentTitle);
  const isMalformed = !/\[[A-Z]+-\d+\]/.test(currentTitle);
  if (!isMalformed && newTitle === currentTitle) {
    continue;
  }

  if (isMalformed || issue.title !== newTitle) {
    planned.push({
      issueNumber: issue.number,
      oldTitle: currentTitle,
      newTitle,
      taskId,
      reason: isMalformed ? "title missing task id" : "title normalization",
    });
  }
}

if (planned.length === 0) {
  console.log("No malformed jobs found.");
  process.exit(0);
}

for (const item of planned) {
  if (!options.apply) {
    console.log(`[dry-run] #${item.issueNumber} ${item.oldTitle} => ${item.newTitle}`);
    continue;
  }
  await patchIssueTitle(options.owner, options.repo, item.issueNumber, item.newTitle, token);
  console.log(`[updated] #${item.issueNumber} -> ${item.newTitle}`);
}

if (!options.apply) {
  console.log(`\nFound ${planned.length} malformed jobs. Re-run with --apply to write updates.`);
} else {
  console.log(`\nRebuilt ${planned.length} malformed jobs.`);
}

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) continue;
    const next = argv[i + 1];
    const [rawKey, rawValue] = value.slice(2).split("=");
    if (rawValue !== undefined) {
      values[rawKey] = rawValue;
      continue;
    }
    if (!next || next.startsWith("--")) {
      values[rawKey] = "true";
      continue;
    }
    values[rawKey] = next;
    i += 1;
  }
  return values;
}

function parseTaskId(text) {
  if (!text) return undefined;
  const bracketMatch = /\[([A-Z]+-\d+)\]/i.exec(text);
  if (bracketMatch?.[1]) return bracketMatch[1];
  const inlineMatch = /\b([A-Z]+-\d+)\b/i.exec(text);
  return inlineMatch?.[1];
}

function pickSummary(body) {
  if (!body) return "";
  const firstParagraph = body.split("\n").find((line) => line.trim().length > 0) ?? "";
  const stripped = firstParagraph
    .replace(/^#+\s*/u, "")
    .replace(/^\*\*Task ID:\*\*.*$/iu, "")
    .replace(/^\*?\s*task id:\s*.*$/iu, "")
    .replace(/^\[([A-Z]+-\d+)\]\s*/u, "")
    .trim();
  return stripped.slice(0, options.summaryLimit).trim();
}

function buildCanonicalTitle(taskId, summary, fallback) {
  const base = summary || fallback || "unlabeled job";
  const trimmed = base.slice(0, 1).toUpperCase() + base.slice(1);
  const title = `[${taskId}] ${trimmed}`;
  return title.length > 140 ? `${title.slice(0, 137)}...` : title;
}

async function listOpenLabeledIssues(owner, repo, label, token) {
  const issues = [];
  let page = 1;

  while (true) {
    const url = new URL(`${GH_API_BASE}/repos/${owner}/${repo}/issues`);
    url.searchParams.set("state", "open");
    url.searchParams.set("labels", label);
    url.searchParams.set("per_page", String(PAGE_SIZE));
    url.searchParams.set("page", String(page));

    const response = await ghRequest(owner, repo, url, token);
    const batch = await response.json();
    issues.push(...batch);

    const hasNext = parseNextPage(response.headers.get("link"));
    if (!hasNext) break;
    page = hasNext;
  }

  return issues;
}

async function fetchIssuesByNumber(owner, repo, issueNumbers, token) {
  const issues = [];
  for (const issueNumber of issueNumbers) {
    if (!Number.isFinite(issueNumber)) continue;
    const response = await ghRequest(owner, repo, new URL(`${GH_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}`), token);
    issues.push(await response.json());
  }
  return issues;
}

async function patchIssueTitle(owner, repo, issueNumber, title, token) {
  const response = await ghRequest(
    owner,
    repo,
    new URL(`${GH_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}`),
    token,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to patch #${issueNumber}: ${response.status} ${text}`);
  }

  await response.text();
}

function parseNextPage(linkHeader) {
  if (!linkHeader) return null;
  const match = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
  if (!match?.[1]) return null;
  try {
    const nextUrl = new URL(match[1]);
    const next = nextUrl.searchParams.get("page");
    if (!next) return null;
    const nextPage = Number.parseInt(next, 10);
    return Number.isFinite(nextPage) ? nextPage : null;
  } catch {
    return null;
  }
}

async function ghRequest(owner, repo, url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GH_API_VERSION,
      "User-Agent": "goblintown-orchestrator-maintenance",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub request failed for ${url.pathname}: ${response.status} ${response.statusText} ${text.slice(0, 200)}`
    );
  }

  return response;
}

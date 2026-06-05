# Clobcode connection + orchestrator dispatch

Give this entire block to Claude:

```bash
cd /Users/angus/goblintown/repo/goblintown/chatgptapp
export BL33P_CRON_SECRET=...
export GITHUB_TOKEN=...

# Multi-repo is enabled when this is set.
# Comma-separated owner/repo values are authoritative.
export DISPATCH_TARGETS="goblintownlol/chatgptapp,goblintownlol/codex-plugin"
export DISPATCH_LABEL="job"

curl -sS -X POST \
  -H "Authorization: Bearer ${BL33P_CRON_SECRET}" \
  -H "Content-Type: application/json" \
  https://goblintown-mcp.vercel.app/api/cron/dispatch
```

Endpoint:

`POST https://goblintown-mcp.vercel.app/api/cron/dispatch`

Headers:
- `Authorization: Bearer ${BL33P_CRON_SECRET}`
- `Content-Type: application/json`

Cron secret env vars:
- Preferred: `BL33P_CRON_SECRET`
- Also accepted for compatibility: `CRON_SECRET`

Fallback (single-repo mode):
- `DISPATCH_TARGETS` unset
- Uses `DISPATCH_OWNER` (default `goblintownlol`)
- Uses `DISPATCH_REPO` (default `chatgptapp`)

Expected run response includes traceability fields:
- `targets` (repos scanned)
- `repoSummaries` (per-repo `open`, `closed`, `assigned`, `skipped`)
- `dispatched[]` entries with `repo`, `issueNumber`, `title`, `taskId`, `assignedTo`
- `skippedIssues[]` entries with `repo`, `issueNumber`, `reason`
- existing fields: `scannedOpen`, `assigned`, `skipped`, `errors`

Reason codes you can alert on:
- `already assigned`
- `unparseable task id`
- `waiting for dependencies: ...`
- `no eligible agents for phase ...`
- assignment errors if any

Example immediate run across multiple repos (recommended):

```bash
export DISPATCH_TARGETS="goblintownlol/chatgptapp,goblintownlol/codex-plugin" \
  && curl -sS -X POST \
  -H "Authorization: Bearer ${BL33P_CRON_SECRET}" \
  -H 'Content-Type: application/json' \
  https://goblintown-mcp.vercel.app/api/cron/dispatch
```

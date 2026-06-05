# Goblintown ChatGPT App store runbook

This runbook covers the end-to-end readiness checks for the ChatGPT App 1.0
dev preview and the production Vercel-hosted adapter.

## Hosted mode (submission path)

## Deployment target

- Hosted base URL: `https://goblintown-mcp.vercel.app`
- MCP endpoint: `/mcp`
- Health check: `/healthz`
- Walkthrough: `/`
- User dashboard placeholder: `/dashboard.html`
- Operator admin placeholder: `/admin.html`

## Required artifacts

- `chatgpt-app-submission.json`
- Adapter health and MCP endpoints at `/healthz`, `/mcp`
- Site pages for privacy and terms:
  - `/privacy.html`
  - `/terms.html`

## Pre-flight automated checks

From a clean checkout:

```bash
npm run -s verify:chatgpt -- --mcp-url https://goblintown-mcp.vercel.app/mcp
npm run -s verify:vercel
npm run -s verify:smoke
```

Shortcut aliases:

```bash
npm run -s verify:chatgpt:hosted
```

If all three checks pass, the hosted surface includes:

- Health response with the expected MCP URL
- `GET /mcp` method protections
- Tank widget resource and required tool list
- Site placeholders for dashboard/admin and legal pages
- Sidecar bootstrap + plugin/skill command discoverability

## Local development mode

For local development, run the same app from the same repo with a tunnel URL:

```bash
npm run chatgpt
# or
npm run chatgpt:local
```

Use `--public-base-url` when creating a tunnel:

```bash
goblintown chatgpt serve --port 8787 --public-base-url https://your-tunnel.example
```

Then run `verify:chatgpt` with that public URL:

```bash
npm run -s verify:chatgpt -- --mcp-url https://your-tunnel.example/mcp
```

Shortcut alias:

```bash
npm run -s verify:chatgpt:local
```

## Manual reviewer flow (login → DAG → run → artifact → settings → logout)

This flow can be used for human QA and store reviewer walkthrough.

1. **Login / handoff launch**
   - Open `https://goblintown-mcp.vercel.app`.
   - Confirm the page renders the MCP URL and legal links.
   - Open a chat in ChatGPT Developer Mode and add MCP server:
     `https://goblintown-mcp.vercel.app/mcp`.

2. **DAG creation**
   - Ask:

   ```text
   Plan a quick Goblintown DAG for "produce a one-paragraph summary of this repo" with no more than 4 nodes.
   ```

   - Confirm `goblintown_plan` appears in the tool call and returns a real plan payload.

3. **Run execution**
   - Ask for a rite/plan execution path through board mode (no local provider required).
   - Confirm the result includes run-oriented structure and does not request external
     destructive actions.

4. **Artifact / run artifact verification**
   - Ask:

   ```text
   Use goblintown_doctor and report readiness and key capability boundaries.
   ```

   - Confirm returned JSON includes `goblintown` tool readiness and setup details.
   - Confirm no API key values are exposed.

5. **Settings / surface visibility**
   - Open:
     - `/dashboard.html` and confirm placeholder text for user dashboard.
     - `/admin.html` and confirm placeholder text for operator admin.
   - Confirm `/privacy.html` and `/terms.html` are linked from the landing page.

6. **Logout / closeout**
   - Remove or disconnect the MCP server in ChatGPT after test completes.
   - Re-run:

   ```bash
   npm run -s verify:chatgpt -- --mcp-url https://goblintown-mcp.vercel.app/mcp
   ```

   - Confirm the endpoint is still healthy after session closure.

## Evidence checklist for submission bundle

- [ ] `verify:chatgpt` passes
- [ ] `verify:vercel` passes
- [ ] `verify:smoke` passes
- [ ] Manual checklist above completed
- [ ] No unresolved placeholders in manifest/tooling coverage
- [ ] Release notes and distribution docs describe ChatGPT App as a first-class path

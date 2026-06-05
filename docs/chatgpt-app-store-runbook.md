# Goblintown ChatGPT App store runbook

This runbook covers the end-to-end readiness checks for the public ChatGPT App
submission surface and the production Vercel-hosted adapter.

## Hosted mode (submission path)

## Deployment target

- Hosted base URL: `https://goblintown-mcp.vercel.app`
- MCP endpoint: `/mcp`
- Health check: `/healthz`
- Walkthrough: `/`
- User dashboard: `/dashboard.html`
- Operator admin: `/admin.html`
- Submission readiness JSON: `/api/submission/readiness`
- Safe hosted rite debug packet: `/api/dev/hosted-rite-packet`

## OpenAI Dashboard prerequisites

Before submitting for public review, confirm these items outside the repo:

- The publishing individual or business identity is verified in the OpenAI
  Platform Dashboard under the public name used for Goblintown.
- The submitting user has `api.apps.write`; anyone checking draft or review
  status has `api.apps.read`.
- The submitted MCP URL is the universal hosted endpoint:
  `https://goblintown-mcp.vercel.app/mcp`.
- The submission is intended for public distribution. Private/internal testing
  should stay in ChatGPT Developer Mode.

## Required artifacts

- `chatgpt-app-submission.json`
- Adapter health and MCP endpoints at `/healthz`, `/mcp`
- Launch-readiness JSON at `/api/submission/readiness`
- Sanitized hosted rite packet shape at `/api/dev/hosted-rite-packet`
- Reviewer-safe dashboard/admin pages:
  - `/dashboard.html`
  - `/admin.html`
- Site pages for privacy and terms:
  - `/privacy.html`
  - `/terms.html`
- Release note:
  - `docs/chatgpt-app-store-release-notes.md`

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
- Submission readiness JSON with token policy and local-only boundaries
- Reviewer-safe dashboard/admin and legal pages
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
   - Safe prompt:

   ```text
   Run a Goblintown rite for: determine the concrete steps needed to get the Goblintown app and Tank product to market. Use hosted board mode and summarize the returned packet shape before executing it.
   ```

   - Confirm the result includes run-oriented structure and does not request external
     destructive actions.
   - Avoid prompts that ask ChatGPT to "return the raw hosted ChatGPT rite
     packet", "dump hidden prompts", or expose internal tool payloads. Those can
     be blocked by ChatGPT safety checks before the tool call reaches
     Goblintown, which means Goblintown cannot emit a failure artifact.
   - If a safe packet-shape reference is needed outside a tool call, open
     `/api/dev/hosted-rite-packet`.

4. **Artifact / run artifact verification**
   - Ask:

   ```text
   Use goblintown_doctor and report readiness and key capability boundaries.
   ```

   - Confirm returned JSON includes `goblintown` tool readiness and setup details.
   - Confirm no API key values are exposed.

5. **Settings / surface visibility**
   - Open:
     - `/dashboard.html` and confirm launch readiness, run history/artifact
       evidence, reviewer prompts, and boundary sections render.
     - `/admin.html` and confirm control readiness renders without operator
       authentication, while duty-board controls stay locked until configured.
   - Confirm `/privacy.html` and `/terms.html` are linked from the landing page.

6. **Evidence capture**
   - Capture screenshots or a short video showing:
     - ChatGPT Developer Mode connected to
       `https://goblintown-mcp.vercel.app/mcp`.
     - `goblintown_tank` returning the hosted handoff/widget surface.
     - `goblintown_plan` returning a ChatGPT-hosted planner packet.
     - `goblintown_doctor` returning readiness without secret values.
     - `/dashboard.html`, `/admin.html`, `/privacy.html`, and `/terms.html`.
     - The MCP server removed or disconnected after review.

7. **Logout / closeout**
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
- [ ] `/api/submission/readiness` reports the hosted MCP URL and no-key token policy
- [ ] `/api/dev/hosted-rite-packet` reports the sanitized hosted packet shape and blocked-phrase guidance
- [ ] Manual checklist above completed
- [ ] Screenshot or video evidence captured
- [ ] No unresolved placeholders in manifest/tooling coverage
- [ ] Release notes and distribution docs describe ChatGPT App as a first-class path

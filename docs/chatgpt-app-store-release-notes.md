# Goblintown ChatGPT App Store Release Notes

## Release target

- App: Goblintown ChatGPT App 1.0
- Universal MCP URL: `https://goblintown-mcp.vercel.app/mcp`
- Hosted base URL: `https://goblintown-mcp.vercel.app`
- Widget resource: `ui://goblintown/tank-v2.html`
- Submission evidence endpoint: `https://goblintown-mcp.vercel.app/api/submission/readiness`

## Hosted tool surface

The hosted ChatGPT app exposes these MCP tools:

- `goblintown_tank`
- `goblintown_rite`
- `goblintown_plan`
- `goblintown_provider`
- `goblintown_capabilities`
- `goblintown_doctor`

Hosted mode intentionally does not expose `goblintown_chat`, because local
Single Goblin execution belongs to the local Codex plugin or local ChatGPT
adapter path.

## Data and token boundaries

- Hosted ChatGPT mode uses ChatGPT as the host model surface and does not
  require `OPENAI_API_KEY`.
- Hosted ChatGPT mode rejects `executionMode: "local_provider"` so it cannot
  spend a user's local/provider tokens.
- Provider keys, imported chats, persistent Hoard artifacts, embeddings, and
  local run history stay on the local Tank, Codex plugin, CLI, or local ChatGPT
  adapter path.
- The public dashboard and admin pages are reviewer-safe launch surfaces. They
  show readiness, control boundaries, and optional operator controls without
  claiming cloud account storage.

## Reviewer flow

1. Open ChatGPT Developer Mode and connect the MCP server URL:
   `https://goblintown-mcp.vercel.app/mcp`.
2. Ask ChatGPT to open the Goblintown handoff page and confirm
   `goblintown_tank` returns the hosted widget surface.
3. Ask ChatGPT to plan a six-node-or-smaller DAG and confirm
   `goblintown_plan` returns a ChatGPT-hosted board packet.
4. Ask ChatGPT to run the doctor and confirm readiness without API key values.
5. Open `/dashboard.html`, `/admin.html`, `/privacy.html`, and `/terms.html`.
6. Disconnect the MCP server when review is complete.

## Verification commands

```bash
npm run build
npm run verify:vercel
npm run verify:chatgpt:hosted
npm run verify:smoke
```

Manual evidence should include screenshots or a short video of Developer Mode
connection, `goblintown_tank`, `goblintown_plan`, `goblintown_doctor`, legal
pages, and MCP disconnection.

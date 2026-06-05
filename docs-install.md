# ChatGPT App + MCP Install and Readiness

Repository: `goblintownlol/chatgptapp`

This repo owns the ChatGPT adapter, MCP bridge, and sidecar-facing entry points.

## Hosted ChatGPT App (first-run path)

1. `cd /Users/angus/goblintown/repo/goblintown/chatgptapp`
2. `npm ci`
3. `npm run build`
4. `npx -y goblintown@latest chatgpt install`

Expected output:

- `chatgpt install` starts a local HTTPS endpoint.
- The flow prints a single MCP endpoint URL ending in `/mcp`.
- The printed URL is ready to paste into **ChatGPT Developer Mode**.

Runtime base for hosted mode:

- MCP URL: `https://goblintown-mcp.vercel.app/mcp`
- Health: `https://goblintown-mcp.vercel.app/healthz`

Hosted startup checks (no local terminal required):

```bash
npm run verify:chatgpt:hosted
```

This validates the Streamable HTTP `/mcp` endpoint and required tool/resource
surface on production.

## Local ChatGPT App development

```bash
cd /Users/angus/goblintown/repo/goblintown/chatgptapp
npm ci
npm run chatgpt
# or
npm run chatgpt:local
```

For a local HTTPS public endpoint, use:

```bash
goblintown chatgpt serve --port 8787 --public-base-url https://your-tunnel.example
```

Local mode uses:

- Local port: `GOBLINTOWN_CHATGPT_PUBLIC_BASE_URL`, `GOBLINTOWN_CHATGPT_HOST`, `GOBLINTOWN_CHATGPT_PORT` (default `8787`)
- MCP bridge port: `GOBLINTOWN_MCP_TANK_PORT` (default `7777`)
- MCP startup timeout override: `GOBLINTOWN_MCP_TANK_START_TIMEOUT_MS`
- Allowed ChatGPT hostnames: `GOBLINTOWN_CHATGPT_ALLOWED_HOSTS`

In local mode, paste `https://your-tunnel.example/mcp` into ChatGPT Developer Mode.

## Required env vars (hosted + local)

### Always-on for hosted/public install

- `GOBLINTOWN_CHATGPT_PUBLIC_BASE_URL`
  - default: `https://goblintown-mcp.vercel.app`

### Local run variables

- `GOBLINTOWN_CHATGPT_HOST` (default `127.0.0.1`)
- `GOBLINTOWN_CHATGPT_PORT` (default `8787`)
- `GOBLINTOWN_CHATGPT_ALLOWED_HOSTS` (comma-separated host allowlist)
- `GOBLINTOWN_MCP_TANK_PORT` (MCP-to-Tank bridge port)
- `GOBLINTOWN_MCP_TANK_START_TIMEOUT_MS`

### Provider/runtime vars (explicit)

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENROUTER_API_KEY`
- `GROQ_API_KEY`
- `TOGETHER_API_KEY`
- `MISTRAL_API_KEY`
- `DEEPSEEK_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `GOBLINTOWN_MODEL_GOBLIN`
- `GOBLINTOWN_MODEL_OGRE`
- `GOBLINTOWN_MODEL_TROLL`
- `GOBLINTOWN_MODEL_SCRIBE`
- `GOBLINTOWN_EMBEDDING_MODEL`

See `/docs/reference/providers.md` for full provider routing and secrets scope.

## Hosted token policy (important)

- Hosted ChatGPT App runs Goblin mode cards as the host model in ChatGPT.
- Local provider keys are **not required by default**.
- `executionMode: local_provider` is intentionally rejected in hosted mode unless explicitly opted in.

## Sidecar checks and verification

### Host mode

```bash
cd /Users/angus/goblintown/repo/goblintown/chatgptapp
npm ci
npm run build
npm run verify:chatgpt -- --mcp-url https://goblintown-mcp.vercel.app/mcp
npm run verify:chatgpt -- --mcp-url https://goblintown-mcp.vercel.app/mcp --connect-url https://goblintown-mcp.vercel.app/mcp
npm run verify:vercel
npm run verify:smoke
```

Preferred alias:

```bash
npm run verify:chatgpt:hosted
```

### Local mode

```bash
cd /Users/angus/goblintown/repo/goblintown/chatgptapp
npm ci
npm run build
npm run verify:chatgpt -- --mcp-url http://127.0.0.1:8787/mcp

Preferred local alias:

```bash
npm run verify:chatgpt:local
```
```

### Expected verification markers

- `goblintown_tank`, `goblintown_rite`, `goblintown_plan`, `goblintown_provider`, `goblintown_capabilities`, `goblintown_doctor`
- `/mcp` does not permit GET without `POST /mcp`
- Health reports the expected MCP URL and active tool list
- Hosted `ask-rite` / `ask-plan` payload includes:
  - `source: "ui/chatgpt-hosted-widget"`
  - `route: "/ui/chatgpt-hosted-widget"`
  - `requested: true`

### One-command smoke check

```bash
cd /Users/angus/goblintown/repo/goblintown/chatgptapp
npm run verify:chatgpt -- --mcp-url https://goblintown-mcp.vercel.app/mcp
npm run verify:vercel
npm run verify:smoke
```

Expected checks:

- no uncaught startup failures from `node dist/cli.js chatgpt serve`
- MCP route is reachable and advertises the expected tool list
- hosted verification returns success and writes a `goblintown-capabilities` payload

## Required scope and ownership reminders

- Dedicated plugin packaging lives in `goblintownlol/codex-plugin`.
- Desktop runtime stays in `goblintownlol/backrooms`.
- Do not duplicate adapter setup in unrelated repos.
### Troubleshooting startup / transport failures

- If install/serve exits immediately with transport errors, check that your base URL is HTTPS and reachable.
- If ChatGPT reports `Connection closed` or `Method not allowed`, verify:
  - `GET /mcp` is only used in browsers and returns `405` with `Allow: POST`.
  - `POST /mcp` reaches `/healthz` tool list with expected mode (`hosted` vs `local`).
- In hosted mode, confirm `GOBLINTOWN_CHATGPT_PUBLIC_BASE_URL` is exactly the public deployment base (for example `https://goblintown-mcp.vercel.app`).

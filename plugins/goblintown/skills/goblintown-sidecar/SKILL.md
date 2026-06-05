---
name: goblintown-sidecar
description: >
  agent-first, model-augmentable orchestration tool compatible with most front ends
  that can run multi-agent rites, planner DAGs, and artifact workflows.
category: Developer Tools
---

This skill is the Codex entry point for local Goblintown execution.

## Why use it

- Launch the Tank from a command path in conversation.
- Keep full runs local and auditable in `.goblintown/`.
- Move between single Goblin and full rite modes without leaving context.

## Available tools

- `goblintown_tank` — launch or reuse the Tank
- `goblintown_chat` — single Goblin assistant mode
- `goblintown_rite` — full multi-agent rite mode
- `goblintown_plan` — planner DAG mode
- `goblintown_provider` — inspect model-route configuration and pricing defaults
- `goblintown_doctor` — validate local setup and run-path readiness

## Installation and refresh

Fastest path:

```bash
npm install -g goblintown
npx -y goblintown@latest install
```

Manual path (equivalent):

```bash
npx -y goblintown@latest plugin install
npx -y goblintown@latest skill install
npx -y goblintown@latest mcp --install-codex
npx -y goblintown@latest mcp --doctor
```

- `goblintown plugin install` adds the plugin entry for Codex composer and this skill package.
- `goblintown skill install` refreshes this skill from the installed package assets.
- `goblintown mcp --install-codex` updates the Codex MCP config used by this toolchain.

Always ask before changing the user's machine or local data.

Privacy Policy: https://goblintown-mcp.vercel.app/privacy.html
Terms of Service: https://goblintown-mcp.vercel.app/terms.html
Codex-local global Warren: `${CODEX_HOME:-$HOME/.codex}/goblintown`

Use `goblintown_doctor` before first heavy run.

# ChatGPT App + MCP Migration Manifest

## Destination repo

- **Current destination:** `goblintownlol/chatgptapp`

## Contents placed here

- ChatGPT adapter + MCP bridge entry points.
- `src/chatgpt-app.ts`, `src/chatgpt-host-runner.ts`, `src/mcp.ts`, `src/cli.ts` and adapter packaging files.
- Sidecar-exposed install/run surfaces for ChatGPT Developer Mode.

## Linked dependencies

- Core backend/runtime remains in `goblintownlol/backrooms`.
- Codex plugin packaging and shared plugin install tooling remain in `goblintownlol/codex-plugin`.

## Responsibilities

- Keep MCP shape compatible with backrooms run records (including `request.activation`).
- Keep ChatGPT adapter command path stable for upstream/backward compatibility.
- Keep `chatgptapp` install/run docs pointed at the split destination and not the monorepo root.

# Codex Plugin Migration Manifest

## Destination repo

- **Current destination:** `goblintownlol/codex-plugin`

## What lives here

- Codex plugin package metadata (`.codex-plugin`, `.mcp.json`).
- Sidecar install + plugin install tooling sources.
- Skill/MCP bootstrap docs and support helpers needed by CLI install flows.

## What this links to

- Core runtime and Tank remains in `goblintownlol/backrooms`.
- ChatGPT adapter artifacts remain in `goblintownlol/chatgptapp`.

## Deployment and install notes

- Dedicated install spot for plugin operations:
  - `codex plugin install` path target should map to `~/plugins/goblintown`.
- Install commands expected:
  - `npx -y goblintown@latest plugin install`
  - `npx -y goblintown@latest skill install`
  - `npx -y goblintown@latest mcp --install-codex`
  - `npx -y goblintown@latest mcp --doctor`
- Plugin/package verification should confirm `./.codex-plugin/plugin.json`, `./.mcp.json`, and skill docs are present in the plugin install directory.

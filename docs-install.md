# Codex Plugin Install & Update Playbook

Repository: `goblintownlol/codex-plugin`

This repository is the dedicated Codex-facing packaging destination.

## Destination and ownership

- Plugin install path: this repo is the canonical location for all Codex plugin packaging, MCP wiring assets, and updater scripts.
- Keep runtime behavior in `goblintownlol/backrooms`.
- Keep ChatGPT-side adapter work in `goblintownlol/chatgptapp`.

Do not run plugin bootstrap from `chatgptapp/` or backrooms root when targeting production plugin packaging.
Use this repository for all packaging, manifest updates, and plugin-path verification.

## Fresh install

Run:

```bash
npx -y goblintown@latest install
```

The one-shot flow runs these practical steps:

1. `npx -y goblintown@latest plugin install`
2. `npx -y goblintown@latest skill install`
3. `npx -y goblintown@latest mcp --install-codex`
4. `npx -y goblintown@latest mcp --doctor`

Equivalent for local bootstrap:

```bash
npx -y goblintown@latest plugin install
npx -y goblintown@latest skill install
npx -y goblintown@latest mcp --install-codex
npx -y goblintown@latest mcp --doctor
codex plugin list
```

## Expected success markers (fresh install)

1. `codex plugin list` contains `goblintown@personal`.
2. `cat ~/.agents/plugins/marketplace.json` contains `"plugins": [{"name":"goblintown"}, ...]`.
3. `npx -y goblintown@latest mcp --doctor` returns JSON containing `"ok": true`.
4. `~/.codex/config.toml` contains:
   - `[mcp_servers.goblintown]`
   - `command = "npx"`
   - `args = ["-y", "goblintown@latest", "mcp"]`
5. `~/plugins/goblintown` contains:
   - `.codex-plugin/plugin.json`
   - `.mcp.json`
   - `skills/goblintown-sidecar/SKILL.md`

After all five checks pass, the Composer `+` menu should display Goblintown as a discoverable plugin.

## Lightweight verification script

```bash
npm run verify:plugin-install
```

The script checks:

- `codex plugin list`
- marketplace registration in `~/.agents/plugins/marketplace.json`
- plugin artifact files in `~/plugins/goblintown`
- `[mcp_servers.goblintown]` in `~/.codex/config.toml`
- `npx -y goblintown@latest mcp --doctor`

Known limitation: Composer menu visibility may need a full Codex restart when plugin files are refreshed.

## Failure modes and repair path

- **`codex` command unavailable**
  - Install/update Codex and reopen shell, or fix `$PATH`.

- **`codex plugin list` missing `goblintown@personal`**
  - Re-run `npx -y goblintown@latest plugin install`.

- **Plugin listed but no marketplace entry**
  - Remove `~/.agents/plugins/marketplace.json` and rerun `npx -y goblintown@latest plugin install`.

- **`mcp --doctor` fails**
  - Run `npx -y goblintown@latest mcp --install-codex` and rerun doctor.

- **Composer icon not visible or stale cache**
  - Re-run install and restart Codex; if needed, clear `~/.codex` plugin cache for a full refresh.

- **`mcp --doctor` returns stale args**
  - Reinstall MCP wiring with `npx -y goblintown@latest mcp --install-codex`.

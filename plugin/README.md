# rucher plugin for Claude Code

Wires [Carnet](../docs/carnet-spec.md) into Claude Code:

- MCP server `carnet` (`rucher serve`): `agent_start`, `agent_update`, `agent_done`, `agent_drop`, `agent_list`, `queue_reorder`, `table_set`, `table_clear`, `log_event`.
- `SessionStart` hook (`rucher hook session-start`): records every session in the group database so the server and the CLI know which session is which.

## Prerequisites

- Node.js 24 or later.
- The `rucher` binary on your `PATH` (`pnpm run build` at the repo root, then `pnpm link --global` in `packages/cli`, or a symlink of `packages/cli/dist/cli.mjs` into `~/.local/bin/rucher`). The plugin calls `rucher` by name, nothing is bundled.
- A group: run `rucher init --repos <paths>` in a meta directory. Outside a group (meta directory or one of its repos) the server still starts, and tools answer `NO_GROUP`.

## Install

```bash
claude plugin marketplace add <path to your rucher clone>   # the repo is its own marketplace
claude plugin install rucher@rucher
claude plugin list
```

After pulling changes: `pnpm run build` (the global link follows `dist/`), and `claude plugin update rucher` when the plugin files changed.

Uninstall: `claude plugin uninstall rucher`, then `claude plugin marketplace remove rucher`.

## Development

Load the plugin from the working tree without installing it:

```bash
claude --plugin-dir ./plugin
```

Validate the manifests: `claude plugin validate plugin` and `claude plugin validate .`.

## Tool names

Claude Code exposes plugin tools as `mcp__plugin_rucher_carnet__<tool>`, for example `mcp__plugin_rucher_carnet__agent_start`. For headless runs, allow the whole server with `--allowedTools mcp__plugin_rucher_carnet`.

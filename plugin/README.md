# rucher plugin for Claude Code

Wires [Carnet](../docs/reference.md) into Claude Code:

- MCP server `carnet` (`rucher serve`): `agent_start`, `agent_update`, `agent_done`, `agent_drop`, `agent_list`, `queue_reorder`, `table_set`, `table_clear`, `log_event`, `log_read`, `agent_step`, `note_add`, `note_list`, `note_drop`, `note_cite`, `session_new`, `session_list`, `session_drop`, `session_resume_info`.
- `SessionStart` hook (`rucher hook session-start`): records every session in the group database so the server and the CLI know which session is which, and watches the Rucher rules of the system prompt: rules version, reminder after a compaction, warning for a session started without `rucher`.
- `UserPromptSubmit` hook (`rucher hook user-prompt-submit`): picks up the session title after a `/rename`, so the session gets its name with the next message.
- `PostToolUse` hook (`rucher hook post-tool-use`, on `Read|Edit|Write|Grep|Glob|Bash`): brings a repo's notes into the session the first time a tool touches that repo.
- `SessionEnd` hook (`rucher hook session-end`): marks the session idle when Claude Code exits, also for sessions started without `rucher`.
- `SubagentStart` and `SubagentStop` hooks (`rucher hook subagent-start|subagent-stop`): pair each fork with its agent by name, give named sub-agents short reporting rules, and move a fork that stopped without `agent_done` to review.
- `rucher` skill (`skills/rucher/SKILL.md`): the multi-agent workflow for the main agent (dispatching, applying, statuses, reports). It loads itself when you ask Claude for forks or parallel work, or with `/rucher`. Generated from [docs/workflow.md](../docs/workflow.md) by `pnpm run build`; edit the doc, not the skill.

## Prerequisites

- Node.js 24 or later.
- The `rucher` binary on your `PATH`: `npm install -g @rucher/cli`, at the same version as the plugin. The plugin calls `rucher` by name, nothing is bundled. For a local build, see Development in the root README.
- A group: `rucher groups create <name> --repos <paths>`. Outside a group (its workspace or one of its repos) the server still starts, and tools answer `NO_GROUP`.

## Install

```bash
claude plugin marketplace add Florian-Varrin/Rucher   # the repo is its own marketplace
claude plugin install rucher@rucher
claude plugin list
```

Update: `npm install -g @rucher/cli@<version>` and `claude plugin update rucher`, so both stay on the same version.

Uninstall: `claude plugin uninstall rucher`, then `claude plugin marketplace remove rucher`.

## Beta

The marketplace also lists `rucher-beta`: this plugin taken from the `staging` branch, whose version is the current beta. Keep it in step with `@rucher/cli@beta`, and never enable both entries: Claude Code would run every hook and the MCP server twice.

```bash
npm install -g @rucher/cli@beta
claude plugin disable rucher@rucher
claude plugin install rucher-beta@rucher            # restart Claude
```

Next beta: `npm install -g @rucher/cli@beta`, `claude plugin marketplace update rucher`, `claude plugin update rucher-beta@rucher`, restart. Back to stable:

```bash
npm install -g @rucher/cli@latest
claude plugin uninstall rucher-beta@rucher
claude plugin enable rucher@rucher                 # restart Claude
```

Under the beta entry the tools are named after it (`mcp__plugin_rucher-beta_carnet__<tool>`, not verified): a headless allowlist needs `--allowedTools mcp__plugin_rucher-beta_carnet`.

## Development

Load the plugin from the working tree without installing it:

```bash
claude --plugin-dir ./plugin
```

Validate the manifests: `claude plugin validate plugin` and `claude plugin validate .`.

## Tool names

Claude Code exposes plugin tools as `mcp__plugin_rucher_carnet__<tool>`, for example `mcp__plugin_rucher_carnet__agent_start`. For headless runs, allow the whole server with `--allowedTools mcp__plugin_rucher_carnet`.

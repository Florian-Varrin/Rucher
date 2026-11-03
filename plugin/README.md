# rucher plugin for Claude Code

Wires [Carnet](../docs/reference.md) into Claude Code:

- MCP server `carnet` (`rucher serve`): `agent_start`, `agent_update`, `agent_done`, `agent_drop`, `agent_list`, `queue_reorder`, `table_set`, `table_clear`, `log_event`, `log_read`, `session_new`, `session_list`, `session_drop`, `session_resume_info`.
- `SessionStart` hook (`rucher hook session-start`): records every session in the group database so the server and the CLI know which session is which, and watches the Rucher rules of the system prompt: rules version, reminder after a compaction, warning for a session started without `rucher`.
- `UserPromptSubmit` hook (`rucher hook user-prompt-submit`): picks up the session title after a `/rename`, so the session gets its name with the next message.
- `SessionEnd` hook (`rucher hook session-end`): marks the session idle when Claude Code exits, also for sessions started without `rucher`.
- `SubagentStart` and `SubagentStop` hooks (`rucher hook subagent-start|subagent-stop`): pair each fork with its agent by name, give named sub-agents short reporting rules, and move a fork that stopped without `agent_done` to review.
- `rucher` skill (`skills/rucher/SKILL.md`): the multi-agent workflow for the main agent (dispatching, applying, statuses, reports). It loads itself when you ask Claude for forks or parallel work, or with `/rucher`. Generated from [docs/workflow.md](../docs/workflow.md) by `pnpm run build`; edit the doc, not the skill.

## Prerequisites

- Node.js 24 or later.
- The `rucher` binary on your `PATH`: `npm install -g @rucher/cli`, at the same version as the plugin. The plugin calls `rucher` by name, nothing is bundled. For a local build, see Development in the root README.
- A group: run `rucher init --repos <paths>` in a meta directory. Outside a group (meta directory or one of its repos) the server still starts, and tools answer `NO_GROUP`.

## Install

```bash
claude plugin marketplace add Florian-Varrin/Rucher   # the repo is its own marketplace
claude plugin install rucher@rucher
claude plugin list
```

Update: `npm install -g @rucher/cli@<version>` and `claude plugin update rucher`, so both stay on the same version.

Uninstall: `claude plugin uninstall rucher`, then `claude plugin marketplace remove rucher`.

## Development

Load the plugin from the working tree without installing it:

```bash
claude --plugin-dir ./plugin
```

Validate the manifests: `claude plugin validate plugin` and `claude plugin validate .`.

## Tool names

Claude Code exposes plugin tools as `mcp__plugin_rucher_carnet__<tool>`, for example `mcp__plugin_rucher_carnet__agent_start`. For headless runs, allow the whole server with `--allowedTools mcp__plugin_rucher_carnet`.

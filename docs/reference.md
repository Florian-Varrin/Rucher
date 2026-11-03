# Reference

Commands, MCP tools, statuses, files and environment variables of Rucher. For the workflow see [workflow.md](workflow.md); for sessions see [sessions.md](sessions.md).

## CLI

| Command                                                | Does                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rucher init [directory] [--name X] [--repos a,b]`     | creates `.rucher/` in the meta directory with the repo paths, registers the group, writes `CLAUDE.md` and `.claude/settings.json` templates when absent                                                                                                                                                                                                                                                                    |
| `rucher group show` / `rucher group add <path>`        | shows the current group; adds a repo path, merges it into `.claude/settings.json` and refreshes the `rucher:repos` block of the group `CLAUDE.md`                                                                                                                                                                                                                                                                          |
| `rucher group remove <path>` / `rucher group sync`     | removes a repo path, then rewrites the context files of the group's hosts from `group.json` (Claude Code: `additionalDirectories` in `.claude/settings.json`, other settings kept, and the `rucher:repos` block of `CLAUDE.md`); `sync` does the rewrite alone. Nothing syncs automatically                                                                                                                                |
| `rucher groups list` / `forget <name\|path>` / `prune` | registered groups of the machine, missing meta directories flagged; `forget` unregisters one (a name shared by several groups is refused, use the path); `prune` unregisters the missing ones. Never pruned on read                                                                                                                                                                                                        |
| `rucher status [--session X] [--all]`                  | agent status of the default session (most recently active, re-resolved on every repaint) or of a named one, its name and repo-relative cwd on the clock line (`16:41 - shop-auth · api`; a dropped session says so); `--all` shows every session with open agents or a table line, most recent first, each headed by its name and cwd relative to its repo (`api/src`), with one clock on top and one legend at the bottom |
| `rucher status --watch [--interval s]`                 | same, repainted when the output changes, for the dedicated pane                                                                                                                                                                                                                                                                                                                                                            |
| `rucher log [--session X] [-n 20]`                     | latest journal events                                                                                                                                                                                                                                                                                                                                                                                                      |
| `rucher log --md [--session X]`                        | journal as markdown, one line per event with commit and report link, for archiving in a repo                                                                                                                                                                                                                                                                                                                               |
| `rucher sessions [--all]`                              | named sessions: name, status, repo-relative cwd, last activity, open agents, purpose; `--all` adds temporary and dropped ones                                                                                                                                                                                                                                                                                              |
| `rucher sessions merge <from> <into>`                  | moves agents (a name already used in `into` is closed in `from`), events and the table line (when `into` has none) into `into`, carries the name when `into` has none, then drops `from`; nothing merges automatically                                                                                                                                                                                                     |
| `rucher resume <name>`                                 | runs the session host's resume command (`claude --resume <id>`), from its original cwd                                                                                                                                                                                                                                                                                                                                     |
| `rucher hook session-start`                            | hook entry point, reads the hook JSON on stdin, records the session, prints the resume context on `source: resume`; exits 0 outside a group or on any error                                                                                                                                                                                                                                                                |
| `rucher hook user-prompt-submit`                       | syncs the Claude session title to the session name on every prompt; no output, exits 0 in every case                                                                                                                                                                                                                                                                                                                       |
| `rucher hook subagent-start`                           | pairs the started subagent with a running Carnet agent in start order, provisionally; exits 0 in every case                                                                                                                                                                                                                                                                                                                |
| `rucher hook subagent-stop`                            | re-pairs by name (the Agent description, else the prompt's ``You are fork `<name>` ``), then moves the agent still `running` to `review`; exits 0 in every case                                                                                                                                                                                                                                                            |
| `rucher serve`                                         | the stdio MCP server; the group is resolved lazily so the server always starts, tools answer `NO_GROUP` outside a group                                                                                                                                                                                                                                                                                                    |
| `rucher complete <shell>`                              | prints the completion script for zsh, bash, fish or powershell (`source <(rucher complete zsh)`); `rucher complete -- <words>` answers the shell with commands, flags, session names and short ids, group names and repo paths; silent outside a group                                                                                                                                                                     |

Default session: the most recently active one of the current group. It changes whenever another session becomes active, which is why every view names its session.

`rucher status` format:

```
16:41 - shop-auth · api

On the table
  ⚙️ Step 11 Preview/Run — applying (main working, not ready)

Waiting on you
  1. 👀 setParent fix (develop) — review, name branch

Running
  ⏳ Step 13 — bricks moved to sidebar

⚙️ main working · 💬 discussing · ❓ answer · 👀 review · 📥 apply · 🧪 test · ✅ commit · 🌿 branch · ⏳ running
```

With `--all`, the clock stands alone on the first line and each session block starts with its own `name · cwd` header. On a narrow terminal only the cwd is cut, never the clock or the name.

## MCP tools

The Carnet MCP server (`rucher serve`, wired by the plugin) gives the agents these tools. All take `session` as an optional override (name, id or id prefix). Each returns one short line plus the entity as structured content; rule violations come back as tool errors with a code. Through the plugin, Claude Code names them `mcp__plugin_rucher_carnet__<tool>`.

**Agents**

| Tool            | Parameters                          | Effect                                                                                                                                                                                 |
| --------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_start`   | name, task, base_commit?, worktree? | creates the agent as ⏳ running, logs `started`, returns the report destination `.rucher/reports/<name>.md`                                                                            |
| `agent_update`  | name, status, note?, report_path?   | changes the status and the displayed text (a running note is cleared when the status leaves running without a new note); `report_path` after main copied the report to its final place |
| `agent_done`    | name, report_path, has_questions    | stores ❓ answer or 👀 review, published at the real stop (SubagentStop) or at once when unpaired; logs `finished` then                                                                |
| `agent_drop`    | name, reason?                       | sets `closed`, logs `dropped`                                                                                                                                                          |
| `agent_list`    | —                                   | structured list, so the main agent knows where it stands                                                                                                                               |
| `queue_reorder` | names[]                             | order of "Waiting on you"                                                                                                                                                              |

**On the table**

| Tool          | Parameters                  | Effect                                                                                                                                 |
| ------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `table_set`   | text, main_working, status? | the "On the table" line, ⚙️ when main_working, else the emoji of `status` (default 💬); `status` is refused together with main_working |
| `table_clear` | —                           | empties the section                                                                                                                    |

**Sessions**

| Tool                  | Parameters                           | Effect                                                                                                                                                                                                |
| --------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_new`         | name, purpose?                       | names or renames the current session and promotes it to `active`; `SESSION_NAME_TAKEN` only when another session has the name; the result asks the human to `/rename` the Claude session the same way |
| `session_list`        | include_temporary?, include_dropped? | sessions by last activity, the current one marked                                                                                                                                                     |
| `session_resume_info` | name?                                | status view, last events and the resume command (current session by default)                                                                                                                          |
| `session_drop`        | name                                 | by name, id or id prefix: status `dropped`, agents closed                                                                                                                                             |

**Journal**

| Tool        | Parameters                          | Effect                                           |
| ----------- | ----------------------------------- | ------------------------------------------------ |
| `log_event` | type, agent?, commit?, link?, note? | appends a line to the journal                    |
| `log_read`  | limit? (1–200, default 20)          | latest entries, oldest first, to rebuild context |

## Statuses

| Status       | Emoji | Who acts                                                |
| ------------ | ----- | ------------------------------------------------------- |
| running      | ⏳    | fork in the background                                  |
| discussing   | 💬    | user                                                    |
| answer       | ❓    | user                                                    |
| review       | 👀    | user                                                    |
| apply        | 📥    | user                                                    |
| test         | 🧪    | user                                                    |
| commit       | ✅    | user                                                    |
| branch       | 🌿    | user                                                    |
| closed       | —     | terminal, hidden from `rucher status`, kept for history |
| main_working | ⚙️    | main (only on the "On the table" line)                  |

Rules enforced by the server:

- User-action emojis are refused for the main agent's own work.
- A note longer than 60 characters is truncated; paths and backticks are stripped. Applied to agent names, notes and the table text.
- Order of "Waiting on you": answer first, then review in plan order, then the rest; `queue_reorder` can override it.
- Agents are never deleted: `agent_drop` closes them, and events keep the history.

## Files and directories

| Path                                               | Holds                                                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `<meta>/.rucher/group.json`                        | group name, absolute repo paths, `hosts` (default `["claude-code"]`)                                                    |
| `<meta>/.rucher/carnet.db`                         | the SQLite database: sessions, agents, the "On the table" line, the journal (WAL mode)                                  |
| `<meta>/.rucher/reports/`                          | fork reports, `<name>.md`                                                                                               |
| `<meta>/CLAUDE.md`, `<meta>/.claude/settings.json` | Claude Code context of the group: repo list and `additionalDirectories`, written by `rucher init` and `rucher group add | remove | sync` |
| `~/.rucher/groups.json`                            | registry of the machine's groups, used to find a group from inside one of its repos                                     |

`<meta>` is the group's meta directory. Nothing is written inside the repos.

## Environment variables

| Variable            | Effect                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `RUCHER_HOME`       | directory of the group registry (default `~/.rucher`)                                                                |
| `RUCHER_PURGE_DAYS` | idle days before sessions without work are purged at session start (default 3; a positive number, fractions allowed) |

# Rucher Carnet — Spec

Library, SQLite database, MCP server and CLI that hold agent statuses, sessions and the journal, in place of the files Claude used to rewrite by hand. First brick of [Rucher](manifesto.md): same data model, reused later by Core and the TUI.

This spec also covers the `rucher` CLI, which is the human-facing view of Carnet.

## Goal

Today the main agent rewrites `agents-status.md` and `log.md` itself, following long rules in `CLAUDE.md`. Carnet replaces those writes with tool calls.

- Fewer tokens: one short call instead of a file rewritten at every event.
- Format guaranteed by code: emojis, order, line length, legend.
- One writer (the server): forks can update their own status without conflicts.
- No more status files: the `rucher` CLI renders views from the database and replaces the `watch glow` pane.

## Scope

| Included                                | Excluded (Rucher, later)                     |
| --------------------------------------- | -------------------------------------------- |
| Agent statuses and "On the table"       | Launching agents (still done by Claude Code) |
| Registry of named sessions              | TUI                                          |
| Event journal                           | Messaging between agents                     |
| Display CLI (status, log, sessions)     | Multiple backends                            |
| Groups (one meta directory = one group) |                                              |

## Groups

A group is a meta directory for a set of related repos (for example `~/groups/shop`). It holds context only: the group `CLAUDE.md`, `.claude/settings.json` whose `additionalDirectories` lists the repos, and the Carnet database. The repos stay at their own paths. Claude sessions start from the meta directory, so the shared context loads and every repo is reachable.

- Marker: a `.rucher/` folder at the meta directory root, holding `carnet.db` and `group.json` (name, repo paths).
- Created by `rucher init [--name X] [--repos a,b]`, which writes `group.json`, scaffolds `CLAUDE.md` and `.claude/settings.json` when absent, and registers the group in `~/.rucher/groups.json`. `rucher group add <path>` adds a repo later and merges it into `additionalDirectories`.
- Resolution: walk up from the current directory (then from `CLAUDE_PROJECT_DIR`) until a `.rucher/` folder is found; otherwise match the directory against the repo paths of the registered groups. So a session started inside a repo attaches to its group, and its `repo` column is the repo folder name.
- Carnet stores no instruction text: the group `CLAUDE.md` is native Claude Code context.

## Data model

One SQLite database per group, at `<meta>/.rucher/carnet.db`, WAL mode.

```sql
sessions (
  id TEXT PRIMARY KEY,        -- Claude Code session id
  name TEXT UNIQUE,           -- set by session_new, equals the Claude session title
  purpose TEXT,
  status TEXT,                -- temporary | active | paused | dropped
  cwd TEXT, repo TEXT,
  claude_pid INTEGER,         -- from the hook, matched against the server's parent pid
  hooked_at TEXT,             -- last SessionStart hook for this row, set only by the hook
  created_at, last_active_at
)

agents (
  session TEXT REFERENCES sessions(id),
  name TEXT,
  task TEXT,
  status TEXT,                -- see Statuses
  note TEXT,                  -- displayed text, under 60 characters
  report_path TEXT, base_commit TEXT, worktree TEXT,
  queue_order INTEGER,        -- order in "Waiting on you"
  claude_agent_id TEXT,       -- Claude subagent id paired by the SubagentStart hook
  pending_status TEXT,        -- outcome stored by agent_done until the fork really stops
  done_at TEXT,               -- when agent_done was called
  started_at, updated_at,
  PRIMARY KEY (session, name)
)

table_items (
  session TEXT PRIMARY KEY REFERENCES sessions(id),
  text TEXT,
  status TEXT,                -- user-action status of the line when main is not working
  main_working INTEGER, updated_at
)

events (
  id INTEGER PRIMARY KEY, session TEXT, at,
  type TEXT,                  -- started | finished | answered | applied | tested | committed | dropped
  agent TEXT, commit_sha TEXT, link TEXT, note TEXT
)
```

## Sessions and the Claude session id

The MCP server process never receives the Claude session id; only hooks do. A `SessionStart` hook is therefore part of the install.

- The hook runs `rucher hook session-start`, which reads the hook JSON on stdin (`session_id`, `cwd`, `source`, `session_title`) and upserts the session row, recording the `claude` process id it receives as `CLAUDE_PID`.
- The MCP server resolves its own session on every call, first hit wins: the `session` tool argument; the row most recently recorded by the hook (`hooked_at`) whose `claude_pid` is the server's parent process id; the `CLAUDE_CODE_SESSION_ID` environment variable (set by Claude Code on MCP server processes, observed on 2.1.316, undocumented), used only when no hook row matches. The environment variable is not trusted first: when the session is picked after startup (`--continue`, the resume picker), Claude Code starts the servers with a provisional id that never gets a transcript, and only the hook sees the real one, sometimes after the server started (spike, 2026-11-01). `claude --resume <id>` keeps the id.
- `/clear` starts a new Claude session in the same process: the hook records it, so Carnet follows the new conversation. Agents still open in the previous session stay there, visible with `rucher status --all`.
- Rows split by an older server (tools written under a provisional id) are joined with `rucher sessions merge <from> <into>`.
- One MCP server process serves the main agent and all its sub-agents, so tools never assume a single caller.
- Every tool accepts an optional `session` argument as an override; by default the server uses its resolved session.
- Wherever a session is referenced (the `session` override, `session_drop`, `session_resume_info`, every CLI argument and `--session`), Carnet accepts its name, its full id or a unique id prefix of at least 4 characters, tried in that order. An ambiguous prefix fails with `SESSION_AMBIGUOUS` listing the matching short ids; anything else unknown fails with `SESSION_NOT_FOUND`. Only a full Claude session id that no hook recorded gets a new row through the `session` override.
- A Carnet session name is the Claude Code session title. `session_new` records the name and purpose. The Claude title is synced by the hooks: `SessionStart` and `UserPromptSubmit` (`rucher hook user-prompt-submit`) both carry `session_title`, so a `/rename`, which fires no hook of its own, names the session with the next prompt and promotes it to `active`; when the payload has no title, the last `custom-title` entry of the transcript is used. A title already used by another session is ignored. Resuming goes through Claude Code itself: `rucher resume <name>` looks the session up by Carnet name and runs `claude --resume <id>` from the session's original cwd (Claude Code stores conversations per project directory), since a Carnet name and a Claude title can drift apart. When `source` is `resume`, the hook prints `additionalContext`: the status view plus the last 20 events, capped at about 2000 characters by dropping the oldest events first.
- Unnamed sessions are recorded with status `temporary`, hidden from `rucher sessions` by default, and purged automatically after a few idle days when they hold no agents and no events. `session_new` promotes a temporary session to `active`.

### Forks that stop without `agent_done`

- `SubagentStart` (`rucher hook subagent-start`) pairs Claude's `agent_id` with the oldest `running` agent of the session that has no pair yet and was started in the last minute. SubagentStart fires in dispatch order (spike, 2026-11-01, 4 and 5 parallel forks), and main calls `agent_start` in an earlier message than the launch, in launch order, so the order matches. A subagent with no candidate stays unpaired; a repeated start for the same `agent_id` keeps its pair.
- `SubagentStop` (`rucher hook subagent-stop`) moves a paired agent still `running` to `review` with the note `stopped without agent_done`, and logs `finished` with that note. A paired agent that already called `agent_done` gets its stored outcome instead.
- `agent_done` stores the outcome (`pending_status`, `report_path`, `done_at`) and keeps a paired agent `running` with the note `reporting`, because the fork still writes its final message. `SubagentStop` publishes it and logs `finished` at the real stop. An unpaired agent publishes at once. Main's `agent_update` publishes any pending outcome first, then applies its status. A pending outcome older than 2 minutes is published on the next read.
- Both hooks exit 0 in every case, outside a group included.

## MCP tools

All tools take `session` as an optional override. Each returns one short text line for the model (and the entity as structured content). Carnet rule violations (unknown agent, duplicate name, bad status) come back as tool errors with a code, so the model can correct itself. Without a resolvable session the server answers `NO_SESSION`.

When the server is shipped through a plugin, Claude Code names the tools `mcp__plugin_<plugin>_<server>__<tool>` (for example `mcp__plugin_rucher_carnet__agent_start`).

**Agents**

| Tool            | Parameters                          | Effect                                                                                                                                                                                 |
| --------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_start`   | name, task, base_commit?, worktree? | creates the agent as ⏳ running, logs `started`                                                                                                                                        |
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

Tools only write to the database; display is the CLI's job.

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

## CLI

No generated markdown files: the `rucher` CLI reads the SQLite database and renders the views.

| Command                                                | Does                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rucher init [directory] [--name X] [--repos a,b]`     | creates `.rucher/` in the meta directory with the repo paths, registers the group, writes `CLAUDE.md` and `.claude/settings.json` templates when absent                                                                                                                             |
| `rucher group show` / `rucher group add <path>`        | shows the current group; adds a repo path, merges it into `.claude/settings.json` and refreshes the `rucher:repos` block of the group `CLAUDE.md`                                                                                                                                   |
| `rucher group remove <path>` / `rucher group sync`     | removes a repo path, then rewrites `additionalDirectories` in `.claude/settings.json` (other settings kept) and the `rucher:repos` block of `CLAUDE.md` from `group.json`; `sync` does the rewrite alone. Nothing syncs automatically                                               |
| `rucher groups list` / `forget <name\|path>` / `prune` | registered groups of the machine, missing meta directories flagged; `forget` unregisters one (a name shared by several groups is refused, use the path); `prune` unregisters the missing ones. Never pruned on read                                                                 |
| `rucher status [--session X] [--all]`                  | agent status of the default session (most recently active) or of a named one; `--all` shows every session with open agents or a table line, most recent first, each headed by its name and cwd relative to its repo (`api/src`), with one clock on top and one legend at the bottom |
| `rucher status --watch [--interval s]`                 | same, repainted when the output changes, for the dedicated pane                                                                                                                                                                                                                     |
| `rucher log [--session X] [-n 20]`                     | latest journal events                                                                                                                                                                                                                                                               |
| `rucher log --md [--session X]`                        | journal as markdown, one line per event with commit and report link, for archiving in a repo                                                                                                                                                                                        |
| `rucher sessions [--all]`                              | named sessions: name, status, repo-relative cwd, last activity, open agents, purpose; `--all` adds temporary and dropped ones                                                                                                                                                       |
| `rucher sessions merge <from> <into>`                  | moves agents (a name already used in `into` is closed in `from`), events and the table line (when `into` has none) into `into`, carries the name when `into` has none, then drops `from`; nothing merges automatically                                                              |
| `rucher resume <name>`                                 | runs `claude --resume <id>` for that session, from its original cwd                                                                                                                                                                                                                 |
| `rucher hook session-start`                            | hook entry point, reads the hook JSON on stdin, records the session, prints the resume context on `source: resume`; exits 0 outside a group or on any error                                                                                                                         |
| `rucher hook user-prompt-submit`                       | syncs the Claude session title to the session name on every prompt; no output, exits 0 in every case                                                                                                                                                                                |
| `rucher hook subagent-start`                           | pairs the started subagent with its Carnet agent; exits 0 in every case                                                                                                                                                                                                             |
| `rucher hook subagent-stop`                            | moves a paired agent still `running` to `review`; exits 0 in every case                                                                                                                                                                                                             |
| `rucher serve`                                         | the stdio MCP server; the group is resolved lazily so the server always starts, tools answer `NO_GROUP` outside a group                                                                                                                                                             |
| `rucher complete <shell>`                              | prints the completion script for zsh, bash, fish or powershell (`source <(rucher complete zsh)`); `rucher complete -- <words>` answers the shell with commands, flags, session names and short ids, group names and repo paths; silent outside a group                              |

Default session: the most recently active one of the current group.

`rucher status` format:

```
16:41

On the table
  ⚙️ Step 11 Preview/Run — applying (main working, not ready)

Waiting on you
  1. 👀 setParent fix (develop) — review, name branch

Running
  ⏳ Step 13 — bricks moved to sidebar

⚙️ main working · 💬 discussing · ❓ answer · 👀 review · 📥 apply · 🧪 test · ✅ commit · 🌿 branch · ⏳ running
```

`--watch` is a plain redraw loop polling the database every second. Ink arrives with the TUI, not before.

Advantages over generated files:

- No external `glow` or `watch`, no partial-write glitches.
- Colors and width adapted to the terminal by the CLI itself.
- One source of truth: the database.
- The CLI and the MCP server share the same data access code.

## Storage and concurrency

- Stdio server: each `claude` session starts its own process. SQLite in WAL mode handles concurrent access.
- Group determined by the launch directory: the database is looked up by walking up to `.rucher/`.
- Fork reports stay markdown files written by the forks; the database only stores their path.

## Integration

- Shipped as a Claude Code plugin from day one: MCP server, `SessionStart` hook and, later, the `rucher` skill in one install. The repo is its own marketplace (`.claude-plugin/marketplace.json` at the root, plugin files in `plugin/`): `claude plugin marketplace add <repo path>` then `claude plugin install rucher@rucher`.
- The plugin calls `rucher` from the `PATH`, nothing is bundled: the `rucher` CLI is linked globally (`pnpm link --global` in `packages/cli`), which also makes it available in the terminal pane. Tools appear as `mcp__plugin_rucher_carnet__<tool>`.
- The multi-agent block of the user's global `CLAUDE.md` shrinks to behavior rules; all format and status-file rules disappear, replaced by "use the rucher tools".

### Usage rules

Decision: forks call `agent_update` and `agent_done` themselves (they inherit the MCP tools); the main agent keeps `agent_start`, `table_set`, `queue_reorder` and the session tools.

Usage rules live at three levels:

| Where                   | Content                                                                                          | Why                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| MCP server instructions | who calls what, when to update (before and after each piece of work), never a status in the chat | injected everywhere the server is connected, forks included; cut at 4,096 characters by Claude Code |
| Tool descriptions       | when to call each tool, allowed status values                                                    | read by the model at every call                                                                     |
| `rucher` skill          | full workflow: two-phase forks, applying a fork, worktrees, reports                              | loaded on demand, invocable with `/rucher`                                                          |

The group's `CLAUDE.md` keeps one line: "multi-agent work: use rucher-carnet and the rucher skill". The canonical rules live in [workflow.md](workflow.md); the user's global `CLAUDE.md` imports it.

## Stack

- pnpm monorepo, Vite+ toolchain (`vp check`, `vp test`, `vp pack`, `vp run`).
- TypeScript, Node 24 baseline, `node:sqlite` (no native dependencies).
- MCP TypeScript SDK v2 (`@modelcontextprotocol/server`), Zod 4, server `instructions`.
- CLI parser: citty.
- Tests: Vitest, temp database per test for the data layer and tool handlers, snapshot tests of the `rucher status` text.

## Roadmap

**Milestone 1**

- [x] SQLite schema and data layer
- [x] Group resolution (`rucher init` logic in the library)
- [x] `SessionStart` hook writing session rows, server session resolution
- [x] Agent and table tools, `queue_reorder`, `log_event` (MCP server in `@rucher/carnet/mcp`)
- [x] `rucher status` (with `--watch`, `--all`), `rucher log`, `rucher init`, `rucher hook session-start`, `rucher serve`
- [x] Plugin install (`plugin/`, local marketplace)
- [ ] Dogfooding on real groups

**Milestone 2**

- [x] `session_new`, `session_list`, `session_drop`, `rucher sessions`, `rucher resume`
- [x] `session_resume_info` and `log_read` with journal injection on resume
- [x] `rucher log --md`
- [ ] Temporary session purge

**Milestone 3**

- [ ] `rucher` skill in the plugin
- [x] `SubagentStop` hook as a safety net for agents left `running`
- [ ] Open source polish: CI, publishing
- [ ] Interactive TUI view, reuse by Rucher Core as internal tools

## Open questions

- [x] Session resolution in the MCP server: hook row by parent pid, `CLAUDE_CODE_SESSION_ID` fallback (spikes, 2026-10-31 and 2026-11-01).
- [x] Hooks fired inside a sub-agent (fork or not) carry the parent `session_id` plus `agent_id` and `agent_type` (spike, 2026-10-31).
- [ ] Confirm `CLAUDE_CODE_SESSION_ID` is also set for interactive sessions and user-scope servers (expected; dogfooding).
- [ ] A single HTTP server (daemon) instead of one stdio process per session?
- [ ] Purge delay for temporary sessions.
- [x] A session started inside a repo attaches to its group through the registry and the repo paths.

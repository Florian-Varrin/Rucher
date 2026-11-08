# Sessions

How Rucher tracks your coding agent's conversations (Claude Code today), and how to name, watch, resume and drop them. For the multi-agent rules see [workflow.md](workflow.md); for commands, tools and files see [reference.md](reference.md).

## What a session is

A Carnet session is one Claude Code conversation inside a workspace. It holds:

- the agents (forks) the main agent started, with their statuses;
- the "On the table" line: what the main agent is handling now;
- the journal: started, finished, answered, applied, tested, committed, dropped.

You never create a session by hand. The plugin's `SessionStart` hook records one each time Claude Code starts, resumes, clears or compacts a conversation in a workspace (its run directory or any of its repos), or a conversation `rucher` launched outside any workspace. The MCP server then writes every tool call of that conversation into it.

A session has a **kind**, which says whether it is worth keeping, and a **status**, which says what its process is doing. The two are independent.

| Kind     | Meaning                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------- |
| `temp`   | the default for a new session; it may have a name; hidden from `rucher sessions` unless `--all`           |
| `active` | a session to keep and come back to; always named (by `session_new`, or the first title of an unnamed one) |

| Status     | Meaning                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------- |
| `idle`     | no Claude process attached                                                                |
| `running`  | a Claude process is attached                                                              |
| `archived` | closed on request; its open agents are closed, its journal is kept; hidden unless `--all` |

The journal also records the life of each session: `session.started`, `session.resumed` and `session.forked`, written by the `SessionStart` hook.

The **default session** of a workspace is the most recently active one that is not archived. Every `rucher` command without `--session` uses it. Wherever a session is expected, you can give its name, its full id, or the start of its id as shown by `rucher sessions --all` (at least 4 characters, and unique).

## Start a session

Start sessions with `rucher`, from anywhere: `--ws` names the workspace, otherwise it comes from the run directory or repo you are in.

```bash
rucher new shop-auth --ws shop  # a named, durable session
rucher tmp                    # a temporary one (a name is optional: rucher tmp shop-try)
rucher new shop-auth -- --model opus   # arguments after -- go to Claude Code
```

`rucher` creates the session in Carnet, renders the workspace's run directory, then runs Claude Code from it, so the workspace instructions load and every repo is reachable. Run from inside a repo, it still starts in the run directory and records that repo as the session's starting repo; outside any workspace, it starts in the current directory. Claude Code gets the session's id (`--session-id`), its name as title (`--name`) and each repo of the workspace with `--add-dir`; the environment carries `RUCHER_SESSION_ID`, `RUCHER_SESSION_NAME`, `RUCHER_WS` (when there is a workspace) and `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`, so the `CLAUDE.md` of each repo loads too; a repo's `AGENTS.md` loads through an import in the generated `CLAUDE.md` of a workspace using `AGENTS.md`, once Claude Code's external imports prompt is approved. The session is `running` while Claude Code runs and `idle` once it exits; a `SessionEnd` hook does the same for sessions started without `rucher`.

Rendering the run directory, at each `new`, `tmp`, `fork` and `resume` and with `rucher ws sync`:

- creates the run directory and its `reports/` folder;
- copies every `.md` file at the top of the workspace definition except `prompt.md` (the instructions and the files they import), each with a marker comment, so their relative `@` imports resolve inside the run directory; a copy whose definition file is gone is removed;
- when the definition holds `AGENTS.md` instead of `CLAUDE.md`, generates a `CLAUDE.md` importing `@AGENTS.md`, `@backends/claude.md` when the definition has that file (copied too, for instructions meant for Claude Code only), and the `AGENTS.md` of each repo that has no `CLAUDE.md`;
- writes `.claude/settings.json` from scratch: a `"//"` marker, `permissions.additionalDirectories` from the repos, a `permissions.deny` `Edit(/<file>)` rule for each copy, then the workspace's `backends["claude-code"].settings` merged over them (lists joined without duplicates);
- touches nothing else: reports, `.mcp.json`, skills, `settings.local.json` and any other file stay.

A workspace's definition holds `AGENTS.md` or `CLAUDE.md`, not both: rendering fails with `WORKSPACE_INSTRUCTIONS_CONFLICT` and names the file to remove. A generated file carries the marker and is rewritten without asking; a hand-written file of the same name in the run directory is refused, never overwritten. The instructions are edited in the definition, with `rucher ws edit`; sessions are denied edits of the copies.

Claude Code applies a run directory's `.claude/settings.json` only once the run directory is trusted: accept the trust prompt in the first session of a new workspace. Until then, `--add-dir` still gives the session its repos.

A session keeps the directory it was launched in: Claude Code stores its transcript there, so hooks never change the recorded `cwd`, even after a `cd`. `resume` and `fork` start from it, and fail with `SESSION_CWD_MISSING` when it no longer exists.

Starting `claude` directly from a run directory or a repo of a workspace still works: the hooks record the session as `temp`. Outside any workspace, a session started without `rucher` is not recorded.

In a side pane, watch it:

```bash
rucher status --watch --ws shop
```

## Name it

`rucher new` names a session from the start. A `temp` session, or one started with `claude`, can be named with `/rename` in Claude Code:

```text
/rename shop-auth
```

The Carnet session takes the name with your next message; an unnamed session then becomes `active`. Starting Claude with a title (`claude -n shop-auth`) names it from the start. A later `/rename` renames it again; a name another session of the workspace already uses is ignored, and the session keeps its current name. The Rucher name is the canonical one: a title is only adopted when it changed since it was last seen, so a rename made in Rucher is not undone by the next message.

You can also ask Claude to name the session (it calls `session_new` with a name and a one-line purpose). It then asks you to run `/rename` with the same name, so Claude Code's own title matches.

From the terminal, once the session has ended:

```bash
rucher sessions rename shop-auth shop-login   # refused while the session is running
rucher sessions promote 5eed shop-try         # temp to active, a name is needed
rucher sessions demote shop-try               # active to temp, the name stays
```

The next `rucher resume` gives Claude Code the new name as its title.

## See what is going on

| Command                                  | Shows                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rucher status`                          | the default session (the most recently active one), its name and workspace next to the clock (`16:41 - shop-auth · shop`): On the table, Waiting on you, Running, legend |
| `rucher status --session shop-auth`      | a given session, by name, id or id prefix (`-s` for short)                                                                                                               |
| `rucher status --all`                    | every session with open agents or a table line: the clock and the workspace, one block per session (its name), one legend                                                |
| `rucher status --watch [--interval 2]`   | repaints when the output changes; combine with `--all` or `--session`                                                                                                    |
| `rucher sessions [--all]`                | active sessions: name (or short id), kind, status, repo-relative cwd, last activity, open agents, purpose; `--all` adds temp and archived ones                           |
| `rucher log [-s shop-auth] [-n 20]`      | the last journal events                                                                                                                                                  |
| `rucher log --md > shop-auth-journal.md` | the journal as Markdown, grouped by day, for archiving                                                                                                                   |

From inside Claude, the main agent has the same view through `session_list`, `session_resume_info` and `log_read`.

## Resume it

```bash
rucher resume shop-auth
rucher resume                 # pick from the workspace's sessions (fzf when installed, a numbered list otherwise)
rucher fork shop-auth shop-auth-alt   # branch it into a new temp session (--active to keep it)
```

`rucher resume <name|id>` looks the session up and runs its host's resume command, `claude --resume <id> --name <name>` for Claude Code, from the directory the session started in (Claude Code stores conversations per project directory). It resumes by id, and passes the Rucher name as title so Claude Code shows the canonical name. An archived session can still be resumed, with a warning; resuming it brings it back into use. Claude Code writes no transcript before the first message, so a session closed before it has nothing to resume: `resume` starts it fresh under the same id and name, and `fork` refuses it.

`rucher fork <session> [<name>] [--active]` resumes the session with `--fork-session`: Claude Code gives the branch a new id, and the `SessionStart` hook records it as a child of the original. The branch is `temp` unless `--active` is given, which needs a name.

On resume, the `SessionStart` hook adds context to the conversation: the session's status view and its last 20 journal events, capped at about 2000 characters (oldest events dropped first). Claude picks up where it stopped without you pasting anything.

The other ways back in also stay in the same Carnet session: `claude --resume <id>`, `claude --continue`, the resume picker and `/resume`. The MCP server follows the session the hooks last recorded for its Claude process, so tool calls land where the conversation is.

`/clear` starts a new conversation in the same Claude process, and Carnet follows it into a new session. Agents still open in the previous one stay there, visible with `rucher status --all`.

## Forks inside a session

Each fork the main agent dispatches is an agent of the session: `agent_start` registers it, the fork reports progress with `agent_update` and ends with `agent_done` (which copies its report into the workspace) and a one-line reply. Until the fork has really stopped it shows as `⏳ name — reporting`, then moves to `❓` or `👀`. The `SubagentStart` and `SubagentStop` hooks are a safety net: they pair each fork with its agent, and a fork that stops without calling `agent_done` moves to `👀 review` with the note `stopped without agent_done`. Pairing goes by name: the main agent calls `agent_start` in an earlier message than the launch, gives the fork the agent name as its Agent description, and starts its prompt with ``You are fork `<name>`.`` Start order is only a fallback.

## The rules a session runs with

A session started with `rucher` gets the Rucher core rules appended to its system prompt (see [workflow.md](workflow.md#where-the-rules-live)), plus the workspace's own rules from `prompt.md` in its definition (`~/.config/rucher/workspaces/<name>/`) and one line naming the session. Forks inherit them; named sub-agents get short reporting rules from the `SubagentStart` hook.

Claude Code keeps a session's system prompt until the conversation is compacted, so:

- A resume, even with plain `claude --resume` or `/resume`, keeps the rules the session started with.
- When the rules changed since, the session start prints `rucher: rules updated, will apply after the next compaction or in a new session`.
- After a compaction in a session that was not launched by `rucher`, the rules are gone from the system prompt; the hook puts them back in the conversation.
- A session never started by `rucher` gets a warning, in its context and on stderr.

## Drop it

Ask Claude to drop a session (`session_drop`, by name, id or id prefix), or run `rucher sessions drop <session>`. It becomes `archived`: its open agents are closed, it leaves the lists and the default choice, and its journal stays. The current session can be dropped too. `--purge` also deletes the conversation transcript Claude Code keeps for it, and prints each deleted path; without `--purge` nothing is deleted.

## Repair a split session

Older versions could split one conversation into two sessions after `--continue` or the picker: your agents and journal under one id, new tool calls under another. Merge them back:

```bash
rucher sessions --all                 # find the two ids
rucher sessions merge <from> <into>   # moves agents, the table line and events into <into>
```

## Which workspace a session belongs to

A session belongs to the workspace Carnet recorded it in. Commands and hooks find the workspace in this order:

1. the session itself, by its id, for hooks and the Carnet server;
2. `--ws, --ws <name>`;
3. `RUCHER_WS`, set by `rucher new`, `tmp`, `resume` and `fork`;
4. the run directory containing the working directory;
5. the workspace whose repo contains the working directory (longest path). A repo of several workspaces is an error naming them: pass `--ws`.

When the directory decided (4 or 5), a command you type says so on stderr: `workspace shop (from api)`. `agent_start` names the workspace in its result.

## Move a session to another workspace

A session started in a shared repo by an older version can land in the wrong workspace. Run from the workspace that has it, or with `--ws`:

```bash
rucher sessions move shop-auth --to shop --dry-run   # what would move
rucher sessions move shop-auth --to shop             # agents, table line, journal
rucher sessions move shop-auth --to shop --merge     # when shop already has the session
```

`--to` takes a workspace name. The session changes workspace; its agents, its table line and its journal follow it, and its notes stay in the workspace they were written in. Without `--merge`, a target with a session of the same name is refused. With `--merge`, the two are joined: agents whose name the target already uses stay out, and the target keeps its table line when it has one. Report files are not moved: copy them to the target's `reports/` by hand.

## Housekeeping

Each time a session starts, the hook purges sessions idle for more than 3 days that never held any work: temp sessions with no agents and no agent events, and archived sessions with no agent events. Session lifecycle events don't count as work and go with the session. Sessions with an agent journal are kept, and so is the session being started. Set `RUCHER_PURGE_DAYS` (a positive number of days) in the environment Claude Code runs in to change the delay.

Temp sessions that did hold work are cleaned by hand:

```bash
rucher sessions clean --dry-run          # what would be archived
rucher sessions clean --older-than 7d    # archive temp sessions idle for more than 7 days (30m, 12h also work)
rucher sessions clean --purge            # and delete their transcripts
```

`clean` also sets back to `idle` the sessions still marked `running` whose Claude Code process is gone (a crash or a closed terminal ends a session without its `SessionEnd` hook).

`rucher log --agents` shows the agent journal without the session starts and ends.

## A typical day

```bash
rucher new shop-auth                  # pane 1
rucher status -w --ws shop  # pane 2
```

1. Give the session a purpose (ask Claude, it calls `session_new`).
2. Let the main agent dispatch forks; answer, review, apply and commit them one by one from "Waiting on you".
3. Quit when done. Tomorrow: `rucher resume shop-auth`, and Claude starts with the status and the last events.
4. `rucher log --md` when you want the day's trace in a file.

# Sessions

How Rucher tracks your coding agent's conversations (Claude Code today), and how to name, watch, resume and drop them. For the multi-agent rules see [workflow.md](workflow.md); for commands, tools and files see [reference.md](reference.md).

## What a session is

A Carnet session is one Claude Code conversation inside a group. It holds:

- the agents (forks) the main agent started, with their statuses;
- the "On the table" line: what the main agent is handling now;
- the journal: started, finished, answered, applied, tested, committed, dropped.

You never create a session by hand. The plugin's `SessionStart` hook records one each time Claude Code starts, resumes, clears or compacts a conversation in a group (the meta directory or any of its repos). The MCP server then writes every tool call of that conversation into it.

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

The **default session** of a group is the most recently active one that is not archived. Every `rucher` command without `--session` uses it. Wherever a session is expected, you can give its name, its full id, or the start of its id as shown by `rucher sessions --all` (at least 4 characters, and unique).

## Start a session

Start sessions with `rucher`, from anywhere in the group:

```bash
rucher new shop-auth          # a named, durable session
rucher tmp                    # a temporary one (a name is optional: rucher tmp shop-try)
rucher new shop-auth -- --model opus   # arguments after -- go to Claude Code
```

`rucher` creates the session in Carnet, then runs Claude Code from the group's meta directory, so the group `CLAUDE.md` loads and every repo is reachable. Run from inside a repo, it still starts in the meta directory and records that repo as the session's starting repo. Claude Code gets the session's id (`--session-id`) and its name as title (`--name`), and the environment carries `RUCHER_SESSION_ID`, `RUCHER_SESSION_NAME` and `RUCHER_GROUP`. The session is `running` while Claude Code runs and `idle` once it exits; a `SessionEnd` hook does the same for sessions started without `rucher`.

Starting `claude` directly from the meta directory still works: the hooks record the session as `temp`.

In a side pane, watch it:

```bash
cd ~/groups/shop && rucher status --watch
```

## Name it

`rucher new` names a session from the start. A `temp` session, or one started with `claude`, can be named with `/rename` in Claude Code:

```text
/rename shop-auth
```

The Carnet session takes the name with your next message; an unnamed session then becomes `active`. Starting Claude with a title (`claude -n shop-auth`) names it from the start. A later `/rename` renames it again; a name another session of the group already uses is ignored, and the session keeps its current name. The Rucher name is the canonical one: a title is only adopted when it changed since it was last seen, so a rename made in Rucher is not undone by the next message.

You can also ask Claude to name the session (it calls `session_new` with a name and a one-line purpose). It then asks you to run `/rename` with the same name, so Claude Code's own title matches.

## See what is going on

| Command                                  | Shows                                                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rucher status`                          | the default session (the most recently active one), its name next to the clock (`16:41 - shop-auth`): On the table, Waiting on you, Running, legend |
| `rucher status --session shop-auth`      | a given session, by name, id or id prefix (`-s` for short)                                                                                          |
| `rucher status --all`                    | every session with open agents or a table line: one clock, one block per session (name and repo-relative cwd), one legend                           |
| `rucher status --watch [--interval 2]`   | repaints when the output changes; combine with `--all` or `--session`                                                                               |
| `rucher sessions [--all]`                | active sessions: name (or short id), kind, status, repo-relative cwd, last activity, open agents, purpose; `--all` adds temp and archived ones      |
| `rucher log [-s shop-auth] [-n 20]`      | the last journal events                                                                                                                             |
| `rucher log --md > shop-auth-journal.md` | the journal as Markdown, grouped by day, for archiving                                                                                              |

From inside Claude, the main agent has the same view through `session_list`, `session_resume_info` and `log_read`.

## Resume it

```bash
rucher resume shop-auth
rucher resume                 # pick from the group's sessions (fzf when installed, a numbered list otherwise)
rucher fork shop-auth shop-auth-alt   # branch it into a new temp session (--active to keep it)
```

`rucher resume <name|id>` looks the session up and runs its host's resume command, `claude --resume <id> --name <name>` for Claude Code, from the directory the session started in (Claude Code stores conversations per project directory). It resumes by id, and passes the Rucher name as title so Claude Code shows the canonical name. An archived session can still be resumed, with a warning; resuming it brings it back into use.

`rucher fork <session> [<name>] [--active]` resumes the session with `--fork-session`: Claude Code gives the branch a new id, and the `SessionStart` hook records it as a child of the original. The branch is `temp` unless `--active` is given, which needs a name.

On resume, the `SessionStart` hook adds context to the conversation: the session's status view and its last 20 journal events, capped at about 2000 characters (oldest events dropped first). Claude picks up where it stopped without you pasting anything.

The other ways back in also stay in the same Carnet session: `claude --resume <id>`, `claude --continue`, the resume picker and `/resume`. The MCP server follows the session the hooks last recorded for its Claude process, so tool calls land where the conversation is.

`/clear` starts a new conversation in the same Claude process, and Carnet follows it into a new session. Agents still open in the previous one stay there, visible with `rucher status --all`.

## Forks inside a session

Each fork the main agent dispatches is an agent of the session: `agent_start` registers it, the fork reports progress with `agent_update` and ends with `agent_done` and a one-line reply. Until the fork has really stopped it shows as `⏳ name — reporting`, then moves to `❓` or `👀`. The `SubagentStart` and `SubagentStop` hooks are a safety net: they pair each fork with its agent, and a fork that stops without calling `agent_done` moves to `👀 review` with the note `stopped without agent_done`. Pairing goes by name: the main agent calls `agent_start` in an earlier message than the launch, gives the fork the agent name as its Agent description, and starts its prompt with ``You are fork `<name>`.`` Start order is only a fallback.

## Drop it

Ask Claude to drop a session (`session_drop`, by name, id or id prefix). It becomes `archived`: its open agents are closed, it leaves the lists and the default choice, and its journal stays. The current session can be dropped too.

## Repair a split session

Older versions could split one conversation into two sessions after `--continue` or the picker: your agents and journal under one id, new tool calls under another. Merge them back:

```bash
rucher sessions --all                 # find the two ids
rucher sessions merge <from> <into>   # moves agents, the table line and events into <into>
```

## Housekeeping

Each time a session starts, the hook purges sessions idle for more than 3 days that never held any work: temp sessions with no agents and no agent events, and archived sessions with no agent events. Session lifecycle events don't count as work and go with the session. Sessions with an agent journal are kept, and so is the session being started. Set `RUCHER_PURGE_DAYS` (a positive number of days) in the environment Claude Code runs in to change the delay.

## A typical day

```bash
rucher new shop-auth                  # pane 1
cd ~/groups/shop && rucher status -w  # pane 2
```

1. Give the session a purpose (ask Claude, it calls `session_new`).
2. Let the main agent dispatch forks; answer, review, apply and commit them one by one from "Waiting on you".
3. Quit when done. Tomorrow: `rucher resume shop-auth`, and Claude starts with the status and the last events.
4. `rucher log --md` when you want the day's trace in a file.

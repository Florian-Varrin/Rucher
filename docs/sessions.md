# Sessions

How Rucher tracks your Claude Code conversations, and how to name, watch, resume and drop them. For the multi-agent rules see [workflow.md](workflow.md); for the data model see [carnet-spec.md](carnet-spec.md).

## What a session is

A Carnet session is one Claude Code conversation inside a group. It holds:

- the agents (forks) the main agent started, with their statuses;
- the "On the table" line: what the main agent is handling now;
- the journal: started, finished, answered, applied, tested, committed, dropped.

You never create a session by hand. The plugin's `SessionStart` hook records one each time Claude Code starts, resumes, clears or compacts a conversation in a group (the meta directory or any of its repos). The MCP server then writes every tool call of that conversation into it.

| Status      | Meaning                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| `temporary` | recorded but not named yet; hidden from `rucher sessions` unless `--all`                  |
| `active`    | named, by `session_new` or by a Claude Code session title (`claude -n`, `/rename`)        |
| `paused`    | reserved, nothing sets it yet                                                             |
| `dropped`   | closed on request; its open agents are closed, its journal is kept; hidden unless `--all` |

The **default session** of a group is the most recently active one that is not dropped. Every `rucher` command without `--session` uses it. Wherever a session is expected, you can give its name, its full id, or the start of its id as shown by `rucher sessions --all` (at least 4 characters, and unique).

## Start a session

Start Claude Code from the group's meta directory, so the group `CLAUDE.md` loads and every repo is reachable:

```bash
cd ~/groups/shop
claude
```

In a side pane, watch it:

```bash
cd ~/groups/shop && rucher status --watch
```

## Name it

Unnamed sessions stay `temporary`. Name the ones you want to come back to with `/rename` in Claude Code:

```text
/rename shop-auth
```

The Carnet session takes the name with your next message, and becomes `active`. Starting Claude with a title (`claude -n shop-auth`) names it from the start. A later `/rename` renames it again; a name another session of the group already uses is ignored, and the session keeps its current name.

You can also ask Claude to name the session (it calls `session_new` with a name and a one-line purpose). It then asks you to run `/rename` with the same name, so Claude Code's own title matches.

## See what is going on

| Command                                  | Shows                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `rucher status`                          | the default session: On the table, Waiting on you, Running, legend                                                            |
| `rucher status --session shop-auth`      | a given session, by name, id or id prefix (`-s` for short)                                                                    |
| `rucher status --all`                    | every session with open agents or a table line: one clock, one block per session (name and repo-relative cwd), one legend     |
| `rucher status --watch [--interval 2]`   | repaints when the output changes; combine with `--all` or `--session`                                                         |
| `rucher sessions [--all]`                | named sessions: name, status, repo-relative cwd, last activity, open agents, purpose; `--all` adds temporary and dropped ones |
| `rucher log [-s shop-auth] [-n 20]`      | the last journal events                                                                                                       |
| `rucher log --md > shop-auth-journal.md` | the journal as Markdown, grouped by day, for archiving                                                                        |

From inside Claude, the main agent has the same view through `session_list`, `session_resume_info` and `log_read`.

## Resume it

```bash
rucher resume shop-auth
```

`rucher resume <name|id>` looks the session up and runs `claude --resume <id>` from the directory the session started in (Claude Code stores conversations per project directory). It resumes by id because a Carnet name and a Claude title can drift apart. A dropped session can still be resumed, with a warning.

On resume, the `SessionStart` hook adds context to the conversation: the session's status view and its last 20 journal events, capped at about 2000 characters (oldest events dropped first). Claude picks up where it stopped without you pasting anything.

The other ways back in also stay in the same Carnet session: `claude --resume <id>`, `claude --continue`, the resume picker and `/resume`. The MCP server follows the session the hooks last recorded for its Claude process, so tool calls land where the conversation is.

`/clear` starts a new conversation in the same Claude process, and Carnet follows it into a new session. Agents still open in the previous one stay there, visible with `rucher status --all`.

## Forks inside a session

Each fork the main agent dispatches is an agent of the session: `agent_start` registers it, the fork reports progress with `agent_update` and ends with `agent_done` and a one-line reply. Until the fork has really stopped it shows as `⏳ name — reporting`, then moves to `❓` or `👀`. The `SubagentStart` and `SubagentStop` hooks are a safety net: they pair each fork with its agent in dispatch order, and a fork that stops without calling `agent_done` moves to `👀 review` with the note `stopped without agent_done`. For the pairing to hold, the main agent calls `agent_start` in an earlier message than the launch, and launches parallel forks in the same order.

## Drop it

Ask Claude to drop a session (`session_drop`, by name, id or id prefix). Its open agents are closed, it leaves the lists and the default choice, and its journal stays. The current session can be dropped too.

## Repair a split session

Older versions could split one conversation into two sessions after `--continue` or the picker: your agents and journal under one id, new tool calls under another. Merge them back:

```bash
rucher sessions --all                 # find the two ids
rucher sessions merge <from> <into>   # moves agents, the table line and events into <into>
```

## Housekeeping

Temporary sessions pile up, one per unnamed conversation. A purge of temporary sessions idle for a few days with no agents and no events is planned; until then they are only hidden.

## A typical day

```bash
cd ~/groups/shop && claude            # pane 1
cd ~/groups/shop && rucher status -w  # pane 2
```

1. Name the session (`shop-auth`) and `/rename` it.
2. Let the main agent dispatch forks; answer, review, apply and commit them one by one from "Waiting on you".
3. Quit when done. Tomorrow: `rucher resume shop-auth`, and Claude starts with the status and the last events.
4. `rucher log --md` when you want the day's trace in a file.

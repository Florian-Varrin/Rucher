# Multi-agent workflow

<!-- skill:skip start -->

The rules of the game for a Claude Code session that drives sub-agents (forks) with Rucher. This file is the single source of truth: the Carnet server instructions and tool descriptions summarise it, and the plugin's `rucher` skill is generated from it (`pnpm run build`).
<!-- skill:skip end -->

## Principles

- **Work can be parallel. Review stays sequential.** Forks work at the same time; the human handles their results one by one, in the order they choose.
- **Nothing prints unless asked.** A fork that finishes is announced in one line. Its report waits in a file.
- **The human keeps the hand.** Only the human launches forks, applies, tests and commits. Agents propose, they never push.
- **Data, not rewritten text.** Agent statuses, the "On the table" line and the journal live in Carnet, written through tools. Nobody writes status files, nobody describes status updates in the chat. The human watches `rucher status --watch`.

## Roles and tools

| Who        | Calls                                  | When                                                                         |
| ---------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| Main agent | `agent_start`                          | right before dispatching a fork                                              |
| Main agent | `table_set` (`main_working=true`)      | before applying, testing or fixing itself                                    |
| Main agent | `table_set` (status) / `table_clear`   | when the item is back in the human's hands, or done                          |
| Main agent | `agent_update`                         | to move an agent to the next human action, or to set its final `report_path` |
| Main agent | `queue_reorder`                        | to change the handling order                                                 |
| Main agent | `log_event`                            | when a step is answered, applied, tested, committed or dropped               |
| Main agent | `agent_drop`                           | when a fork's work is committed or abandoned                                 |
| Main agent | `agent_list`                           | to recall where things stand                                                 |
| Fork       | `agent_update` (`running`, short note) | at meaningful progress                                                       |
| Fork       | `agent_done`                           | as its last tool action, with the report path, then a one-line reply         |

Update **before and after** each piece of work, never batched at the end of a turn. Notes and table text stay under 60 characters, without paths or backticks.

## Dispatching a fork

A fork starts from the main agent's context, works alone, writes its report to a file, updates its status, then waits.

- Pick a short name (what the human will read in the status pane) and a one-line task. Call `agent_start` with both, then launch the fork in a later message: the SubagentStart hook pairs forks with Carnet agents in start order, so the agent must exist before the fork starts. Launch parallel forks in the same order as their `agent_start` calls.
- The fork's prompt states: its agent name, the exact base commit, where to write its report (`<scratchpad>/<name>.md`), and that `agent_done` must be its last tool action with `has_questions` set when the report asks the human something, followed by a one-line final message. Until the fork has really stopped, the pane shows it as `⏳ running · reporting`.
- Forks never commit, push or stash. A fork writes its report only to its scratchpad; the main agent copies it into the group.
- Read-only analysis forks need no worktree.
- Dev forks get their own git worktree only when the human allows worktrees. First step, always: `git reset --hard <exact base commit>`, then reinstall dependencies with the lockfile frozen, because worktrees can be created from stale commits.
- Remove the worktree and its branch once the work is committed in the main repo.

### Two phases for design work

Phase 1: the fork analyses, then writes numbered questions, each with a recommendation, and stops (`agent_done` with `has_questions=true`). The human answers. Phase 2: the fork implements after the answers.

## When a fork finishes

- The main agent says one line in the chat: `<name> finished, report ready`. Nothing more. Reports and questions of other forks are held until the human asks for them.
- The main agent copies the report to the report destination `agent_start` returned: `.rucher/reports/<name>.md` in the group's meta directory, outside the repos, never committed. Then it calls `agent_update` with that `report_path`. One file per fork; the human's answers are appended there once given.
- When the human asks for a report, the main agent reads the fork file instead of keeping reports in context.
- Once the human has answered, `log_event answered` and `agent_update` to the next status (`running` if the fork resumes, `review` if the human will read the result).

## Applying a fork

1. `table_set` with `main_working=true` naming the step. The human sees ⚙️ and knows it is not ready.
2. Diff the worktree (`git add -N` for new files), `git apply -3` into the main repo, uncommitted. Resolve conflicts.
3. Run typecheck and tests in the main repo. Audit the comments.
4. Present: a short summary of what was done, how to test, the open questions with recommendations, and a one-line commit message.
5. `agent_update` to `test`, then `commit` as the human advances; `log_event applied`, then `tested`, then `committed` with the sha.
6. After the commit: `agent_drop` with a short reason, `table_clear`, remove the worktree.

Dropped work: revert it in the main repo, keep its patch in the scratchpad, `agent_drop` with the reason. The event journal keeps the trace.

## Status reference

| Status     | Emoji | Who acts | Meaning                               |
| ---------- | ----- | -------- | ------------------------------------- |
| running    | ⏳    | fork     | working in the background             |
| discussing | 💬    | human    | under discussion                      |
| answer     | ❓    | human    | questions waiting in the report       |
| review     | 👀    | human    | result ready to read                  |
| apply      | 📥    | human    | ready to apply                        |
| test       | 🧪    | human    | applied, to test                      |
| commit     | ✅    | human    | tested, to commit                     |
| branch     | 🌿    | human    | needs a branch decision               |
| closed     | —     | —        | finished, hidden, kept in the journal |

`⚙️` is not an agent status: it marks the "On the table" line while the main agent itself is working.

"Waiting on you" is ordered answer first, then review, then the rest, oldest first inside each bucket. `queue_reorder` overrides it: named agents come first in the given order.

## What the human sees

- `rucher status --watch` in a side pane: the "On the table" line, the numbered "Waiting on you" list, the running forks, the legend.
- `rucher log` for the journal: started, finished, answered, applied, tested, committed, dropped, with report links and commit shas.
- Nothing about status in the chat.

<!-- skill:skip start -->

- Sessions (naming, resuming, dropping): [sessions.md](sessions.md).

<!-- skill:skip end -->

<!-- skill:skip start -->

## Loading these rules

The plugin's `rucher` skill carries this workflow: it loads itself when you ask Claude for forks or parallel work, or with `/rucher`. To have the rules in every session regardless, import this file from your `CLAUDE.md`: `@<path to your rucher clone>/docs/workflow.md`.

## Groups on disk

One meta directory per group of related repos (for example under `~/groups/`: `rucher/`, `shop/`, `blog/`). It holds context only: `CLAUDE.md`, `.claude/settings.json` with the repos as `additionalDirectories`, the Carnet database and the fork reports in `.rucher/`. The repos stay at their own paths. `rucher init --repos <paths>` creates it, `rucher group add <path>` extends it, Claude sessions start from it, and `rucher status --watch` works from the meta directory or from any of its repos.
<!-- skill:skip end -->

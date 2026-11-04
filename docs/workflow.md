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

| Who        | Calls                                  | When                                                                                   |
| ---------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| Main agent | `agent_start`                          | right before dispatching a fork                                                        |
| Main agent | `agent_step`                           | at each step of a fork's work: answered, applying, applied, tested, committed, dropped |
| Main agent | `table_set` / `table_clear`            | for work that is not a fork's: `main_working=true` while working itself                |
| Main agent | `agent_update` / `agent_drop`          | for moves `agent_step` does not cover                                                  |
| Main agent | `queue_reorder`                        | to change the handling order                                                           |
| Main agent | `agent_list`                           | to recall where things stand                                                           |
| Main agent | `note_add` / `note_drop`               | at the end of a step: what was learned, decided or ruled out                           |
| Fork       | `agent_update` (`running`, short note) | at meaningful progress                                                                 |
| Fork       | `agent_done`                           | as its last tool action, with the report path, then a one-line reply without results   |
| Both       | `note_list` / `note_cite`              | before trying an approach; cite a note when it changed what you did                    |

Update **before and after** each piece of work, never batched at the end of a turn. Notes and table text stay under 60 characters, without paths or backticks.

## Dispatching a fork

A fork starts from the main agent's context, works alone, writes its report to a file, updates its status, then waits.

- Pick a short name (what the human will read in the status pane) and a one-line task. Call `agent_start` with both, then launch the fork in a later message, so the agent exists before the fork starts.
- Launch the fork with the agent name as the Agent tool `description`, and a prompt that starts with ``You are fork `<name>`.`` The hooks pair forks with Carnet agents by that name; start order is only a fallback, and it is unreliable when several forks start at once.
- The fork's prompt states: its agent name, the exact base commit, where to write its report (`<scratchpad>/<name>.md`), and that `agent_done` must be its last tool action with `has_questions` set when the report asks the human something, followed by a one-line final message that carries no results (`<name> done, report written`), and that the report ends with a `## Learnings` section (see [Memory](#memory)). Until the fork has really stopped, the pane shows it as `⏳ running · reporting`.
- Forks never commit, push or stash. A fork writes its report only to its scratchpad; the main agent copies it into the group.
- Read-only analysis forks need no worktree.
- Dev forks get their own git worktree only when the human allows worktrees. First step, always: `git reset --hard <exact base commit>`, then reinstall dependencies with the lockfile frozen, because worktrees can be created from stale commits.
- Remove the worktree and its branch once the work is committed in the main repo.

### Two phases for design work

Phase 1: the fork analyses, then writes numbered questions, each with a recommendation, and stops (`agent_done` with `has_questions=true`). The human answers. Phase 2: the fork implements after the answers.

## When a fork finishes

- The main agent says one line in the chat: `<name> finished, report ready`. Nothing more: no summary, no figures, no questions from the report, no action on it, even when the fork's final message carries results or when the human asks about something else. A report is presented only when the human asks for that fork's report; the reports of other forks stay held, also when several forks finish together.
- `agent_done` copies the report to the report destination `agent_start` returned: `<workspace>/reports/<name>.md`, in the group's workspace, outside the repos, never committed. One file per fork; the human's answers are appended there once given.
- When the human asks for a report, the main agent reads the fork file instead of keeping reports in context.
- Once the human has answered, `agent_step answered`: the agent moves to `apply`, or pass `next` (`running` if the fork resumes, `review` if the human will read the result).

## Applying a fork

1. `agent_step applying`. The human sees ⚙️ and knows it is not ready.
2. Diff the worktree (`git add -N` for new files), `git apply -3` into the main repo, uncommitted. Resolve conflicts.
3. Run typecheck and tests in the main repo. Audit the comments.
4. Present: a short summary of what was done, how to test, the open questions with recommendations, and a one-line commit message.
5. `agent_step applied` (agent and table line move to `test`), then `tested` (to `commit`) as the human advances.
6. After the commit: `agent_step committed` with the sha closes the agent and clears its table line. Promote the report's `Learnings` with `note_add`, remove the worktree.

Dropped work: revert it in the main repo, keep its patch in the scratchpad, promote its `Learnings` (a dropped fork is the best source of `dead_end` notes), then `agent_step dropped` with the reason as `note`. The event journal keeps the trace.

## Memory

The group's notes outlive sessions: what was learned, decided or ruled out. Sessions get them in their context; `note_list` finds the rest.

- **Forks never call `note_add`.** A fork's report ends with a `## Learnings` section: candidate notes, one per line, `<kind> [<repo>, ...] <text>`, kind `learning`, `dead_end` or `decision`, repos only when the note holds for some repos of the group. Write `none` when there is nothing.
- **The main agent records notes once per step, at its end**, never on the fly: the fork's `Learnings` when its work is applied or dropped, and what it learned itself. One claim per note, with its reason, under 200 characters, no backticks or markdown.
- **Before trying an approach**, check the notes in context, and `note_list` with `query` when in doubt: a `dead_end` exists to stop the next session from hitting the same wall.
- **`note_drop`** when a note proves wrong or outdated, with the reason; add the corrected note first and pass it as `replaced_by`.
- **`note_cite`**, for forks and the main agent alike, only when a note changed what you did, with what it changed (`avoided the Workers migration, #14`). Never for a plain read.

```text
## Learnings

dead_end [shop-api] sessions on Workers: the cold start breaks the SSR cache
decision auth stays in a cookie session: partner SSO requires cookies
```

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

## Where the rules live

- **System prompt:** a session started with `rucher` gets the core rules below appended to its system prompt. Forks inherit it; named sub-agents (`Explore`, `general-purpose`, your own agents) get the sub-agent rules from the `SubagentStart` hook instead.
- **Skill:** the full workflow above is the plugin's `rucher` skill. It loads itself when you ask Claude for forks or parallel work, or with `/rucher`.
- **Server instructions:** the Carnet MCP server tells every session which tool to use when; no workflow rules there. A session started without `rucher` gets the core rules from the `SessionStart` hook instead.

`~/.config/rucher/prompt.md` replaces the core rules, and `prompt.md` in a group's source (`~/.config/rucher/groups/<name>/`) adds rules for that group. Claude Code keeps a session's system prompt until the conversation is compacted, so new rules reach a running session only after its next compaction, or in a new session.

### Core rules

<!-- prompt:core start -->

- Work can be parallel, review stays sequential: forks work at the same time, the human handles their results one at a time.
- The human keeps the hand: only the human launches forks, applies, tests and commits. Agents propose, they never push.
- Status lives in Carnet: agent statuses, the "On the table" line and the journal go through the Carnet tools, never into status files nor chat updates. Update before and after each piece of work.
- When a fork finishes, say only "<name> finished, report ready". Never summarise, quote or act on its report or final message until the human asks for that fork's report, even when answering about something else.
- Forks never commit, push, stash or record notes. A fork writes its report to a file, ending with a Learnings section, calls agent_done as its last tool action, then replies with one line that carries no results, such as "<name> done, report written". Only the main agent records notes, at the end of a step.
- To dispatch, apply or review forks, load the rucher skill: it holds the full workflow.

<!-- prompt:core end -->

## Groups on disk

A group has a source and a workspace. The source, `~/.config/rucher/groups/<name>/`, is what you edit: `group.json` (the repos) and `CLAUDE.md` (the shared instructions). The workspace, `~/.local/share/rucher/workspaces/<name>/`, is the cwd of the group's sessions: a link to the instructions, the generated `.claude/settings.json` with the repos as `additionalDirectories`, and the fork reports in `reports/`. Every group shares one Carnet database, `~/.local/share/rucher/carnet.db`. The repos stay at their own paths. `rucher groups create <name> --repos <paths>` creates a group, `rucher group add <path>` extends it, `rucher new` starts its sessions in the workspace from anywhere, and every command takes `-g <name>` or finds the group from the workspace or repo you are in.
<!-- skill:skip end -->

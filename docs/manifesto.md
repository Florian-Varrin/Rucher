# Rucher — Manifesto

> An apiary is a set of hives. Each hive has its queen and its workers.
> Rucher is a set of sessions. Each session has its main agent and its sub-agents.

_Rucher_ is the French word for apiary.

## The observation

Coding agents have become good enough to work in parallel. The tools, however, are not designed for a human to follow that parallelism.

- Sub-agents disappear when they finish.
- Their results all land at once in the main conversation, and you lose track of where you are.
- Sessions pile up by the hundreds, anonymous, and you never know which one to resume.
- The context of a multi-repo project is rebuilt by hand at every session.
- The tools that solve these problems impose either a GUI, another model provider, or a pay-per-token API key.

The bottleneck is no longer the agent. It is the human who has to re-read, decide and integrate.

## The conviction

**Work can be parallel. Review stays sequential.**

Agents work at the same time; the human handles their results one by one, when they decide, in the order they choose. Rucher exists to protect that attention: nothing must interrupt, everything must be findable again.

## What Rucher is

Rucher is not an application. It is a **series of components and workflows** for agentic development and sub-agent management, each useful on its own, assembled progressively.

We do not write a big TUI in one go. We add a brick when the lack is felt, use it daily, and the next one builds on it.

## Principles

1. **Terminal first.** Everything is driven from the keyboard, in tmux, next to the editor.
2. **On top of what exists, not instead of it.** Rucher relies on Claude Code as it is: its sessions, its forks, its hooks, its MCP. It fills the gaps, it does not reimplement.
3. **Nothing prints unless asked.** An agent that has finished says so in one line. The full report waits in a file.
4. **The human keeps the hand.** Only the user launches sub-agents, applies, tests and commits. Agents propose, they never push.
5. **Data, not rewritten text.** State (agents, sessions, journal) lives in a database, written through tools. Views are computed, never maintained by hand by the model.
6. **Everything is rebuildable.** A session can restart from scratch from its journal, without the full history.
7. **Few sessions, well named.** One session per feature or per durable thread; the rest is temporary and disappears.
8. **Each component stands on its own.** It is useful from day one, without waiting for the next ones.
9. **Open to models.** Designed for Claude first, but not locked in: one backend can replace another.
10. **By the rules.** Rucher uses the user's installation and subscription through the official tools, never a diverted token nor a hosted service.

## Components

| Component                | Role                                                                                                                      | Form                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Multi-agent workflow** | The rules of the game: two-phase forks, parallel work and sequential review, reports in files, applying a fork, worktrees | [docs](workflow.md) + the plugin's `rucher` skill     |
| **Groups**               | One group per set of related repos (a product's api, web and infra): repo map, shared instructions, directory access      | source in `~/.config/rucher` + rendered workspace     |
| **Carnet**               | The shared state: agent statuses, "On the table", sessions, journal                                                       | library + SQLite database + MCP server for the agents |
| **CLI `rucher`**         | The human entry point: `status`, `log`, `sessions`, `resume`, and later the TUI                                           | CLI built on Carnet                                   |
| **Sessions**             | A small set of named, resumable sessions; the others temporary                                                            | registry in Carnet + `SessionStart` hook              |
| **Journal**              | What was done, decided, committed; enough to rebuild a session                                                            | events table + markdown export                        |
| **Core**                 | The engine: SDK wrapper, agents, forks, permissions, normalized events; reads and writes Carnet                           | TypeScript library, later                             |
| **TUI**                  | One window: chat, `@agent` routing, agent list, permission queue                                                          | Ink on top of Core, later                             |
| **GUI**                  | The same thing in graphical form, if the need ever arises                                                                 | on top of Core, maybe                                 |
| **Backends**             | Claude first, OpenCode or others later, behind one interface                                                              | adapters in Core, later                               |

_Carnet_ is French for notebook.

## Workflows

**One fork, one task, one report.** Each sub-agent starts from the main agent's context, works alone, writes its report and its questions to a file, updates its status, then waits.

**Two phases for design work.** Phase 1: analysis and numbered questions, each with a recommendation. The user answers. Phase 2: implementation.

**Parallel in writing, sequential in integration.** Forks work in their worktree. Integration happens one step at a time in the main repo: apply, test, re-read, commit.

**A dashboard, not a discussion thread.** The user permanently sees what is on the table, what is waiting for them and what is running, with the next action for each agent.

## What Rucher is not

- Not an autonomous agent that ships a feature without the human.
- Not a web service nor a SaaS. A GUI would only come last, on top of the same Core.
- Not a replacement for Claude Code: a layer on top.
- Not a big project to finish before it is useful.

## Progression

1. **Workflow** — the rules of the game, [documented](workflow.md). _Done._
2. **Groups** — one group per set of repos, managed by `rucher` and usable from anywhere. _Done._
3. **Carnet + CLI** — state leaves markdown and moves into a database, written by the agents through MCP; the `rucher` CLI replaces the status files. _Done._
4. **Sessions** — registry, resume by name, temporary sessions. _Done._
5. **`rucher` skill + plugin** — the workflow packaged, installable in one command. _Done._
6. **Core + TUI** — the engine, then the terminal interface launched by `rucher`, once the previous bricks have shown what is really missing. _Next._
7. **Multiple backends** — when the need for other models is real. _Prepared: Carnet and the CLI isolate Claude Code as a host._
8. **GUI** — a graphical interface plugged into the same Core as the TUI, if the need arises.

Each step stops where it is useful. The next one starts only if the lack is felt.

---

Reference: [commands, tools and files](reference.md) · [workflow](workflow.md) · [sessions](sessions.md)

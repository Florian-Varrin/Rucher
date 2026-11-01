# Rucher

Components and workflows for multi-agent development on top of Claude Code.

> _Rucher_ is French for apiary: a set of hives, each with its queen and its workers.
> Rucher is a set of sessions, each with its main agent and its sub-agents.

**Work can be parallel. Review stays sequential.** Agents work at the same time; the human handles their results one by one, when they decide, in the order they choose. Rucher exists to protect that attention: nothing interrupts, everything can be found again.

Read the [manifesto](docs/manifesto.md) for the full picture.

## Status

Early. Personal tooling first, open source in the making. Nothing is published yet.

## Components

| Component    | Role                                                                                            | State                              |
| ------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------- |
| Workflow     | Rules for multi-agent work: two-phase forks, parallel work, sequential review, reports in files | in use, moving into this repo      |
| Groups       | One meta directory per set of related repos: repo map, shared instructions, directory access    | next                               |
| Carnet       | Shared state: agent statuses, "On the table", sessions, journal. Library + SQLite + MCP server  | [spec](docs/carnet-spec.md)        |
| CLI `rucher` | Human entry point: `status`, `log`, `sessions`, `resume`                                        | [spec](docs/carnet-spec.md)        |
| Core + TUI   | SDK wrapper, agents, forks, permissions; one-window terminal UI                                 | [spec](docs/rucher-spec.md), later |

## Repository layout

```
packages/carnet   library, SQLite schema, MCP server
packages/cli      the rucher binary
plugin/           Claude Code plugin: hooks, MCP wiring, skill
docs/             manifesto and specs
```

## Requirements

- Node.js 24 or later (`node:sqlite` is used, no native build step)
- pnpm
- Claude Code installed and logged in

## Install (from source, for now)

```bash
pnpm install
pnpm run build                          # builds @rucher/carnet and @rucher/cli
cd packages/cli && pnpm link --global   # puts `rucher` on your PATH
```

Then, in a meta directory holding your related repos:

```bash
rucher init                 # creates .rucher/, a CLAUDE.md and .claude/settings.json template
rucher status --watch       # the status pane
rucher log                  # the journal
```

Claude Code wiring (MCP server `rucher serve` and the `SessionStart` hook `rucher hook session-start`) ships as a plugin in `plugin/`, see its README once it lands.

## Development

```bash
pnpm install
pnpm run build        # carnet must be built before the cli type-checks or tests
pnpm exec vp check    # format, lint, type check
pnpm run test
pnpm run ready        # build, check, test
```

The toolchain is [Vite+](https://viteplus.dev). The `vite-plus` dev dependency is the source of truth; a global `vp` is optional.

## Claude Code terms

Rucher drives the official `claude` binary and Claude Code's own sessions, forks, hooks and MCP. It uses your Claude Code installation and your subscription, under Anthropic's terms. It handles no authentication, never reads or reuses your OAuth token, and has no hosted version.

## License

[MIT](LICENSE)

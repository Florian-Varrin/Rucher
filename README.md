# Rucher

Components and workflows for multi-agent development on top of Claude Code.

> _Rucher_ is French for apiary: a set of hives, each with its queen and its workers.
> Rucher is a set of sessions, each with its main agent and its sub-agents.

**Work can be parallel. Review stays sequential.** Agents work at the same time; the human handles their results one by one, when they decide, in the order they choose. Rucher exists to protect that attention: nothing interrupts, everything can be found again.

Read the [manifesto](docs/manifesto.md) for the full picture.

## Status

Early. Personal tooling first, open source in the making. Nothing is published yet.

## Components

| Component    | Role                                                                                            | State                                |
| ------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------ |
| Workflow     | Rules for multi-agent work: two-phase forks, parallel work, sequential review, reports in files | [docs/workflow.md](docs/workflow.md) |
| Groups       | One meta directory per set of related repos: repo map, shared instructions, directory access    | next                                 |
| Carnet       | Shared state: agent statuses, "On the table", sessions, journal. Library + SQLite + MCP server  | [spec](docs/carnet-spec.md)          |
| CLI `rucher` | Human entry point: `status`, `log`, `sessions`, `resume`                                        | [spec](docs/carnet-spec.md)          |
| Core + TUI   | SDK wrapper, agents, forks, permissions; one-window terminal UI                                 | [spec](docs/rucher-spec.md), later   |

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

If pnpm has no global bin directory (`ERR_PNPM_NO_GLOBAL_BIN_DIR`), a symlink does the same job:

```bash
ln -s "$PWD/packages/cli/dist/cli.mjs" ~/.local/bin/rucher
```

Then create a meta directory for each group of related repos. It holds context only (`CLAUDE.md`, `.claude/settings.json`, the Carnet database); the repos stay where they are and are referenced by path:

```bash
mkdir -p ~/groups/shop && cd ~/groups/shop
rucher init --name shop --repos ~/code/shop-api,~/code/shop-web
rucher group add ~/code/shop-infra     # later additions
rucher status --watch                  # the status pane
rucher log                             # the journal
rucher log --md > journal.md           # the journal as markdown
rucher group remove ~/code/shop-infra  # drop a repo
rucher group sync                      # rewrite settings and the CLAUDE.md repo list from group.json
rucher groups list                     # every registered group, missing ones flagged
rucher groups prune                    # forget groups whose meta directory is gone
rucher sessions                        # named sessions
rucher resume shop-auth                # back into a named session
rucher sessions merge <from> <into>    # join a session split by a resume
```

Start Claude sessions from the meta directory: its `CLAUDE.md` is the shared context and `additionalDirectories` gives access to the repos. Sessions started inside one of the repos attach to the same group.

Naming, watching, resuming and dropping sessions: [docs/sessions.md](docs/sessions.md).

Wire Claude Code with the plugin (MCP server plus `SessionStart` hook), the repo being its own marketplace:

```bash
claude plugin marketplace add <path to your rucher clone>
claude plugin install rucher@rucher
```

Details, update and uninstall in [plugin/README.md](plugin/README.md). For development, `claude --plugin-dir ./plugin` loads it from the working tree.

### Shell completion

`rucher complete <shell>` prints a completion script (zsh, bash, fish, powershell). Add the line for your shell to its rc file:

```bash
source <(rucher complete zsh)        # ~/.zshrc
source <(rucher complete bash)       # ~/.bashrc
rucher complete fish | source        # ~/.config/fish/config.fish
```

Commands and flags complete as you type; `--session`, `resume` and `sessions merge` offer session names, then short ids; `groups forget` offers group names, `group remove` the group's repos.

## Development

```bash
pnpm install
pnpm run check       # format, lint, type check
pnpm run test        # the built-binary test needs pnpm run build first
pnpm run build       # the rucher binary in packages/cli/dist
pnpm run ready       # build, check, test
```

Inside the workspace, `@rucher/carnet` resolves to its sources through the `development` export condition, so type checks and tests need no prior build. Published packages use `dist`.

The toolchain is [Vite+](https://viteplus.dev). The `vite-plus` dev dependency is the source of truth; a global `vp` is optional.

## Claude Code terms

Rucher drives the official `claude` binary and Claude Code's own sessions, forks, hooks and MCP. It uses your Claude Code installation and your subscription, under Anthropic's terms. It handles no authentication, never reads or reuses your OAuth token, and has no hosted version.

## License

[MIT](LICENSE)

# Rucher

Components and workflows for multi-agent development with coding agents. Claude Code is the supported host today.

> _Rucher_ is French for apiary: a set of hives, each with its queen and its workers.
> Rucher is a set of sessions, each with its main agent and its sub-agents.

**Work can be parallel. Review stays sequential.** Agents work at the same time; the human handles their results one by one, when they decide, in the order they choose. Rucher exists to protect that attention: nothing interrupts, everything can be found again.

Read the [manifesto](docs/manifesto.md) for the full picture.

## Status

Early (0.x), used daily by its author. Commands, APIs and the database schema may change before 1.0. Published on npm as [`@rucher/cli`](https://www.npmjs.com/package/@rucher/cli) and [`@rucher/carnet`](https://www.npmjs.com/package/@rucher/carnet).

## Components

| Component    | Role                                                                                            | State                                |
| ------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------ |
| Workflow     | Rules for multi-agent work: two-phase forks, parallel work, sequential review, reports in files | [docs/workflow.md](docs/workflow.md) |
| Groups       | One meta directory per set of related repos: repo map, shared instructions, directory access    | done                                 |
| Carnet       | Shared state: agent statuses, "On the table", sessions, journal. Library + SQLite + MCP server  | [reference](docs/reference.md)       |
| CLI `rucher` | Human entry point: `status`, `log`, `sessions`, `resume`                                        | [reference](docs/reference.md)       |
| Sessions     | Named, resumable sessions; temporary ones purged                                                | [docs/sessions.md](docs/sessions.md) |
| Plugin       | Claude Code wiring: MCP server, hooks, `rucher` skill                                           | [plugin/README.md](plugin/README.md) |
| Core + TUI   | SDK wrapper, agents, forks, permissions; one-window terminal UI                                 | later                                |

## Repository layout

```
packages/carnet   library, SQLite schema, MCP server
packages/cli      the rucher binary
plugin/           Claude Code plugin: hooks, MCP wiring, skill
docs/             manifesto, workflow, sessions, reference
```

## Requirements

- Node.js 24 or later (`node:sqlite` is used, no native build step)
- Claude Code installed and logged in

## Quick start

```bash
npm install -g @rucher/cli
claude plugin marketplace add Florian-Varrin/Rucher
claude plugin install rucher@rucher

mkdir -p ~/groups/shop && cd ~/groups/shop
rucher init --name shop --repos ~/code/shop-api,~/code/shop-web
rucher status --watch     # in a side pane
claude                    # in another pane, from the same directory
```

A group is a meta directory for a set of related repos. It holds context only (`CLAUDE.md`, `.claude/settings.json`, the Carnet database); the repos stay where they are and are referenced by path. Keep the CLI and the plugin on the same version: after `npm install -g @rucher/cli@<version>`, run `claude plugin update rucher`.

## Commands

```bash
rucher group add ~/code/shop-infra     # add a repo to the group
rucher group remove ~/code/shop-infra  # drop a repo
rucher group sync                      # rewrite the hosts' context files (CLAUDE.md, settings) from group.json
rucher groups list                     # every registered group, missing ones flagged
rucher groups prune                    # forget groups whose meta directory is gone
rucher status --watch                  # the status pane
rucher log                             # the journal
rucher log --md > journal.md           # the journal as markdown
rucher sessions                        # named sessions
rucher resume shop-auth                # back into a named session
rucher sessions merge <from> <into>    # join a session split by a resume
```

Start Claude sessions from the meta directory: its `CLAUDE.md` is the shared context and `additionalDirectories` gives access to the repos. Sessions started inside one of the repos attach to the same group.

Naming, watching, resuming and dropping sessions: [docs/sessions.md](docs/sessions.md).

The plugin (MCP server, hooks and the `rucher` skill) comes from this repository, which is its own marketplace. Details, update and uninstall in [plugin/README.md](plugin/README.md).

### Shell completion

`rucher complete <shell>` prints a completion script (zsh, bash, fish, powershell). Add the line for your shell to its rc file:

```bash
source <(rucher complete zsh)        # ~/.zshrc
source <(rucher complete bash)       # ~/.bashrc
rucher complete fish | source        # ~/.config/fish/config.fish
```

Commands and flags complete as you type; `--session`, `resume` and `sessions merge` offer session names, then short ids; `groups forget` offers group names, `group remove` the group's repos.

## Development

Requires pnpm 12 (pinned by `devEngines`; npm refuses to run inside the repo).

```bash
git clone https://github.com/Florian-Varrin/Rucher.git && cd Rucher
pnpm install
pnpm run check       # format, lint, type check
pnpm run test        # the built-binary test needs pnpm run build first
pnpm run build       # the rucher binary in packages/cli/dist
pnpm run ready       # build, check, test
```

Inside the workspace, `@rucher/carnet` resolves to its sources through the `development` export condition, so type checks and tests need no prior build. Published packages use `dist`.

The toolchain is [Vite+](https://viteplus.dev). The `vite-plus` dev dependency is the source of truth; a global `vp` is optional.

To use a local build instead of the published CLI: `ln -s "$PWD/packages/cli/dist/cli.mjs" ~/.local/bin/rucher` (after `npm uninstall -g @rucher/cli`), and `claude --plugin-dir ./plugin` to load the plugin from the working tree.

## Releasing

Releases go through [Changesets](https://github.com/changesets/changesets) and GitHub Actions.

- Pull requests run `.github/workflows/verify.yml`: build, check, test. Pull requests from forks run it without any secret.
- Only pushes that change what ships trigger the release: `packages/` (not their Markdown), `plugin/` (not its README), `.claude-plugin/`, the root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, or a pending changeset in `.changeset/`. Docs, `.github/` and other root files skip it.
- Such a push to `master` is a release (`.github/workflows/production.yml`): it reads the pending changesets, verifies, bumps the versions, commits `CI : version bump [skip ci]` as `github-actions[bot]`, tags each bumped component (`carnet-v<version>`, `cli-v<version>`) and publishes them to npm. A push without a pending changeset fails.
- `pnpm changeset` adds one. A summary starting with `internal:` releases without a changelog line.
- Merging a pull request is a push to `master`: before merging one that changes code, make sure it carries a changeset (ask for one or add it to the branch).
- `@rucher/carnet` and `@rucher/cli` are versioned independently; a carnet release also releases the cli. The Claude Code plugin has no code of its own and takes the cli version.
- pnpm is pinned by `devEngines` in `package.json`; `PNPM_VERSION` in the workflows must match (checked by CI).

Repository settings the release needs:

- Secret `RELEASE_PAT`: a fine-grained token on this repository with `Contents: read and write`, used to push the bump commit and the tags.
- Secret `NPM_TOKEN`: an npm automation token allowed to publish the `@rucher` scope.
- A ruleset on `master`: restrict deletions, block force pushes, require a pull request before merging, with the repository admin (the `RELEASE_PAT` owner) in the bypass list so direct pushes and the bump commit go through.
- Pull requests: squash merging only, head branches deleted on merge; approval required before running workflows from first-time contributors' forks.

## Claude Code terms

Rucher drives the official `claude` binary and Claude Code's own sessions, forks, hooks and MCP. It uses your Claude Code installation and your subscription, under Anthropic's terms. It handles no authentication, never reads or reuses your OAuth token, and has no hosted version.

## License

[MIT](LICENSE)

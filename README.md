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
| Groups       | One group per set of related repos: repo map, shared instructions, directory access             | done                                 |
| Carnet       | Shared state: agent statuses, "On the table", sessions, journal. Library + SQLite + MCP server  | [reference](docs/reference.md)       |
| CLI `rucher` | Human entry point: `status`, `log`, `sessions`, `resume`                                        | [reference](docs/reference.md)       |
| Sessions     | Named, resumable sessions; temporary ones purged                                                | [docs/sessions.md](docs/sessions.md) |
| Memory       | Notes the group learned, decided or ruled out, shared by its sessions                           | [docs/memory.md](docs/memory.md)     |
| Plugin       | Claude Code wiring: MCP server, hooks, `rucher` skill                                           | [plugin/README.md](plugin/README.md) |
| Core + TUI   | SDK wrapper, agents, forks, permissions; one-window terminal UI                                 | later                                |

## Repository layout

```
packages/carnet   library, SQLite schema, MCP server
packages/cli      the rucher binary
plugin/           Claude Code plugin: hooks, MCP wiring, skill
docs/             manifesto, workflow, sessions, memory, reference
```

## Requirements

- Node.js 24 or later (`node:sqlite` is used, no native build step)
- Claude Code installed and logged in

## Quick start

```bash
npm install -g @rucher/cli
claude plugin marketplace add Florian-Varrin/Rucher
claude plugin install rucher@rucher

rucher groups create shop --repos ~/code/shop-api,~/code/shop-web
rucher status --watch -g shop   # in a side pane
rucher new shop-auth -g shop    # in another pane: starts Claude Code in the group's run directory
```

A group is a set of related repos, managed by `rucher`. Its definition, `~/.config/rucher/groups/<name>/` (`group.json`, `CLAUDE.md`), is what you edit and can keep in your dotfiles. Its run directory, `~/.local/share/rucher/workspaces/<name>/`, is the cwd of its sessions: copies of the instructions, a generated `.claude/settings.json` giving access to the repos, and the fork reports. All groups share one Carnet database, `~/.local/share/rucher/carnet.db`. The repos stay where they are and are referenced by path; nothing is written inside them. Keep the CLI and the plugin on the same version: after `npm install -g @rucher/cli@<version>`, run `claude plugin update rucher`.

## Commands

```bash
rucher groups list                     # the groups, with repo and session counts
rucher group add ~/code/shop-infra     # add a repo to the group
rucher group remove ~/code/shop-infra  # drop a repo
rucher group edit                      # the group's instructions in $EDITOR, then sync
rucher group sync                      # render the run directory from the group's definition
cd "$(rucher group path -g shop)"      # the run directory
rucher groups rename shop store        # the run directory keeps its path
rucher groups drop store               # archive its sessions, keep its notes
rucher status --watch                  # the status pane
rucher log                             # the journal
rucher log --md > journal.md           # the journal as markdown
rucher sessions                        # named sessions
rucher resume shop-auth                # back into a named session
rucher sessions merge <from> <into>    # join a session split by a resume
rucher sessions move <session> --to <group>  # move a session to its right group
```

Run `rucher` from anywhere: `-g <name>` picks the group, otherwise the run directory or the repo you are in does (longest path; a repo shared by several groups needs `-g`). `rucher new` and `rucher tmp` start Claude Code in the run directory, so the group's instructions load and every repo is reachable; a session keeps its group and its launch directory, whatever it does with `cd`.

Naming, watching, resuming and dropping sessions: [docs/sessions.md](docs/sessions.md).

The plugin (MCP server, hooks and the `rucher` skill) comes from this repository, which is its own marketplace. Details, update and uninstall in [plugin/README.md](plugin/README.md).

### Shell completion

`rucher complete <shell>` prints a completion script (zsh, bash, fish, powershell). Add the line for your shell to its rc file:

```bash
source <(rucher complete zsh)        # ~/.zshrc
source <(rucher complete bash)       # ~/.bashrc
rucher complete fish | source        # ~/.config/fish/config.fish
```

Commands and flags complete as you type; `--session`, `resume` and `sessions merge` offer session names, then short ids; `-g`, `sessions move --to`, `groups rename` and `groups drop` offer group names, `group remove` the group's repos.

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

Betas go through the `staging` branch (`.github/workflows/staging.yml`); every push to it runs the beta release:

- Cut a beta: merge `develop` into `staging` and push. The run enters Changesets pre mode (`.changeset/pre.json`) on its first beta, bumps to `<version>-beta.<n>`, commits `CI : beta version bump [skip ci]` to `staging` only, tags `carnet-v<version>` / `cli-v<version>` like a stable release, and publishes to npm under the `beta` dist-tag; `latest` never moves. Each beta needs a new changeset, as on `master`.
- Ship the betas: merge `staging` into `master`. The production run leaves pre mode, releases every package still on a beta version at its stable version, and removes `.changeset/pre.json`. Before the next beta cycle, merge `master` back into `staging` (and `develop`) so `staging` starts from the stable versions.
- Try a beta: `npm install -g @rucher/cli@beta`, then switch the plugin to the `rucher-beta` entry of the marketplace, which follows the `staging` branch (see [plugin/README.md](plugin/README.md)). Back to stable: `npm install -g @rucher/cli@latest` and switch the plugin back.

Repository settings the release needs:

- Secret `RELEASE_PAT`: a fine-grained token on this repository with `Contents: read and write`, used to push the bump commit and the tags.
- Secret `NPM_TOKEN`: an npm automation token allowed to publish the `@rucher` scope.
- A ruleset on `master`: restrict deletions, block force pushes, require a pull request before merging, with the repository admin (the `RELEASE_PAT` owner) in the bypass list so direct pushes and the bump commit go through.
- Pull requests: squash merging only, head branches deleted on merge; approval required before running workflows from first-time contributors' forks.

## Claude Code terms

Rucher drives the official `claude` binary and Claude Code's own sessions, forks, hooks and MCP. It uses your Claude Code installation and your subscription, under Anthropic's terms. It handles no authentication, never reads or reuses your OAuth token, and has no hosted version.

## License

[MIT](LICENSE)

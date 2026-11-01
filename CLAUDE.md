# Rucher

Monorepo for Rucher: components and workflows for multi-agent development on top of Claude Code. Read `docs/manifesto.md` first, then the spec of the component you touch.

## Layout

- `packages/carnet`: library, SQLite schema, MCP server (`docs/carnet-spec.md`).
- `packages/cli`: the `rucher` binary, built on carnet.
- `plugin/`: Claude Code plugin (hooks, MCP wiring, skill).
- `docs/`: manifesto, specs and `workflow.md`. Specs are living documents: update them when a decision changes.

Multi-agent work in this repo follows `docs/workflow.md`: agent status and journal through the rucher tools, never status files.

## Conventions

- Everything committed is English: code, comments, docs, commit messages.
- Node 24 baseline. `node:sqlite` for storage, no native dependencies.
- MCP TypeScript SDK v2 (`@modelcontextprotocol/server`), Zod 4.
- pnpm workspaces, Vite+ toolchain: `vp check`, `vp test`, `vp pack`, `vp run`.
- Tests in Vitest next to each package (`tests/`), temp database per test.
- Workspace packages import each other's sources through the `development` export condition: `vp check` and `vp test` need no prior build. Only the built-binary test needs `pnpm run build`.
- Comments: few, short, explain why only when not obvious.
- Names: no abbreviations (`directory`, `reference`, `index`, `event`, not `dir`, `ref`, `i`, `e`). Allowed short names: `io`, `env`, `id`, `db`, `ctx`. Names that mirror an external API keep its spelling (`cwd`, `ppid`, `session_id`, `CLAUDE_PID`, citty `args`). Host-specific names (`CLAUDE_PID`, `CLAUDE_CODE_SESSION_ID`, `claude --resume`, `CLAUDE.md`) stay in `packages/carnet/src/hosts/`.
- Style: single quotes, enforced by Oxfmt.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# @rucher/cli

## 0.2.0

### Minor Changes

- 8bfc488: Support `AGENTS.md` as a group's instructions, rendered into the workspace with a generated `CLAUDE.md`.
- da5ce09: Groups are managed by `rucher` and usable from anywhere: a group is a source in `~/.config/rucher/groups/<name>/` (`group.json`, `CLAUDE.md`) and a workspace in `~/.local/share/rucher/workspaces/<name>/` where its sessions run, with copies of its instructions and its repos passed with `--add-dir`, every group shares one Carnet database, and every group command takes `-g, --group`. New `rucher groups create|rename|drop` and `rucher group edit|path`; `rucher init`, the group registry and `groups forget|prune` are removed. Sessions keep their group and their launch directory whatever the cwd does, and notes are numbered per group
- ac76418: Spend fewer tokens on Carnet: tool results are short text only, the new `agent_step` tool moves a fork through each step in one call, `agent_done` copies the report into the group, `table_set` keeps `main_working` when omitted, and the server instructions only say which tool to use when, while sessions started without rucher get the full rules at start
- 3625941: Rename groups to workspaces: `rucher ws` replaces `group` and `groups`, `--ws` and `RUCHER_WS` replace `-g`, `--group` and `RUCHER_GROUP`, definitions move to `~/.config/rucher/workspaces/` with `workspace.json`, `ws path` takes `--def` and `--run`, and `--ws` also works before a subcommand. `ws rename` is out until it can move a run directory.
- a941d53: Launch and manage Claude Code sessions with Rucher, and give each group a shared memory

  - `rucher new`, `tmp`, `resume` and `fork` start Claude Code in the group's workspace, with the Rucher rules appended to the system prompt
  - Sessions get a kind (active or temp) and a status (running, idle, archived); `rucher sessions rename`, `promote`, `demote`, `drop` and `clean` manage them, and the Rucher name stays canonical
  - Group notes (learnings, dead ends, decisions) with `rucher notes`, MCP tools, citations and weights; they reach sessions at start and when a repo is first touched
  - `rucher status` shows the session's note activity, and `--watch` gains keys to read and drop notes
  - Fork reports stay held until the human asks for them

### Patch Changes

- 3cd28bf: Complete sessions, repos and notes from the group given by `-g`.
- 3cfac8b: Order the journal by event time, so events moved from another group show where they happened
- f25e0be: Say when no group resolved instead of showing an empty list
- 098a714: Pair forks with their Carnet agents by name when they stop, so forks launched together are never mixed up
- e0dbc71: Keep a session in its group when its working directory moves into a repo shared by several groups, and add `rucher sessions move` to repair a session recorded in the wrong group
- 1531871: Resume a session closed before its first message
- 09297ff: `rucher status` shows the group instead of the repo-relative cwd on its header: `HH:MM - <session> · <group>`, and `HH:MM - <group>` on top of `--all`, so the database being read is always visible.
- Updated dependencies [8bfc488]
- Updated dependencies [da5ce09]
- Updated dependencies [ac76418]
- Updated dependencies [3cfac8b]
- Updated dependencies [098a714]
- Updated dependencies [e0dbc71]
- Updated dependencies [3625941]
- Updated dependencies [1531871]
- Updated dependencies [a941d53]
  - @rucher/carnet@0.2.0

## 0.1.0

### Minor Changes

- 7521f81: Initial release

### Patch Changes

- Updated dependencies [7521f81]
  - @rucher/carnet@0.1.0

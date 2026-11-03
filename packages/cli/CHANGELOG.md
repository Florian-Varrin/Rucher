# @rucher/cli

## 0.2.0-beta.2

### Minor Changes

- ac76418: Spend fewer tokens on Carnet: tool results are short text only, the new `agent_step` tool moves a fork through each step in one call, `agent_done` copies the report into the group, `table_set` keeps `main_working` when omitted, and the server instructions only say which tool to use when, while sessions started without rucher get the full rules at start

### Patch Changes

- 3cfac8b: Order the journal by event time, so events moved from another group show where they happened
- Updated dependencies [ac76418]
- Updated dependencies [3cfac8b]
  - @rucher/carnet@0.2.0-beta.2

## 0.2.0-beta.1

### Patch Changes

- e0dbc71: Keep a session in its group when its working directory moves into a repo shared by several groups, and add `rucher sessions move` to repair a session recorded in the wrong group
- 09297ff: `rucher status` shows the group instead of the repo-relative cwd on its header: `HH:MM - <session> · <group>`, and `HH:MM - <group>` on top of `--all`, so the database being read is always visible.
- Updated dependencies [e0dbc71]
  - @rucher/carnet@0.2.0-beta.1

## 0.2.0-beta.0

### Minor Changes

- a941d53: Launch and manage Claude Code sessions with Rucher, and give each group a shared memory

  - `rucher new`, `tmp`, `resume` and `fork` start Claude Code from the group's meta directory, with the Rucher rules appended to the system prompt
  - Sessions get a kind (active or temp) and a status (running, idle, archived); `rucher sessions rename`, `promote`, `demote`, `drop` and `clean` manage them, and the Rucher name stays canonical
  - Group notes (learnings, dead ends, decisions) with `rucher notes`, MCP tools, citations and weights; they reach sessions at start and when a repo is first touched
  - `rucher status` shows the session's note activity, and `--watch` gains keys to read and drop notes
  - Fork reports stay held until the human asks for them

### Patch Changes

- 098a714: Pair forks with their Carnet agents by name when they stop, so forks launched together are never mixed up
- Updated dependencies [098a714]
- Updated dependencies [a941d53]
  - @rucher/carnet@0.2.0-beta.0

## 0.1.0

### Minor Changes

- 7521f81: Initial release

### Patch Changes

- Updated dependencies [7521f81]
  - @rucher/carnet@0.1.0

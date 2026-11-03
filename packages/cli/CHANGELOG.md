# @rucher/cli

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

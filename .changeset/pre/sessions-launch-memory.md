---
'@rucher/carnet': minor
'@rucher/cli': minor
---

Launch and manage Claude Code sessions with Rucher, and give each group a shared memory

- `rucher new`, `tmp`, `resume` and `fork` start Claude Code from the group's meta directory, with the Rucher rules appended to the system prompt
- Sessions get a kind (active or temp) and a status (running, idle, archived); `rucher sessions rename`, `promote`, `demote`, `drop` and `clean` manage them, and the Rucher name stays canonical
- Group notes (learnings, dead ends, decisions) with `rucher notes`, MCP tools, citations and weights; they reach sessions at start and when a repo is first touched
- `rucher status` shows the session's note activity, and `--watch` gains keys to read and drop notes
- Fork reports stay held until the human asks for them

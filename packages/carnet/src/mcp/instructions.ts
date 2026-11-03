export const INSTRUCTIONS = `Carnet holds the forks, the "On the table" line, sessions, the journal and the group memory that the \`rucher\` CLI renders. The session is resolved automatically; pass \`session\` only to target another one. The workflow rules are in the system prompt and the rucher skill: load the skill before dispatching, applying or reviewing forks.

Which tool, when:
- Dispatch: agent_start, then launch the fork in a later message.
- Each step of a fork's work: agent_step (answered, applying, applied, tested, committed, dropped).
- Main agent working on something else: table_set, table_clear.
- Other moves: agent_update, agent_drop, queue_reorder. Recall: agent_list, log_read, session_resume_info, session_list.
- Memory: note_list before an approach, note_add and note_drop at the end of a step (main agent), note_cite when a note changed what you did.
- Session: session_new when the human names it, session_drop only when asked.
- Fork: agent_update (running, short note) at progress, agent_done last.

Statuses (the NEXT action): running ⏳ · discussing 💬 · answer ❓ · review 👀 · apply 📥 · test 🧪 · commit ✅ · branch 🌿. Notes and table text: under 60 characters, no paths, no backticks.`;

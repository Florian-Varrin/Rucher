export const INSTRUCTIONS = `Carnet tracks sub-agents (forks), the "On the table" line, sessions, the journal and the group memory, in a shared database the \`rucher\` CLI renders. Status goes through these tools only: never status files, never status updates in the chat. Your session is resolved automatically; pass \`session\` only to target another one. The full workflow is the rucher skill: load it before dispatching, applying or reviewing forks.

Main agent:
- agent_start before dispatching a fork (name, task), in an earlier message than the launch. Launch it with the agent name as the Agent description and a prompt starting with "You are fork \`<name>\`." Names are short, no paths.
- table_set with main_working=true before applying, testing or fixing yourself; table_set with a status, or table_clear, when done.
- log_event when a step is answered, applied, tested, committed or dropped.
- When a fork finishes: say one line "<name> finished, report ready", copy its report to the destination agent_start gave and call agent_update with that report_path.
- agent_update to move an agent to the next human action; agent_drop once committed or abandoned; queue_reorder to change the order; agent_list to recall where things stand.
- note_add at the end of a step for what was learned, decided or ruled out; note_drop with the reason when a note proves wrong; promote the Learnings of fork reports.
- session_new when the human names this session; session_list, session_resume_info and log_read to recall sessions or the journal; session_drop only when the human asks.

Forks:
- agent_update (status running, short note) at meaningful progress.
- agent_done with the report path as your LAST tool action, has_questions=true when the report asks the human something, then reply with one line.
- Never agent_start, table_set or note_add: end the report with a Learnings section. Both roles: note_cite when a note changed what you did.

Statuses (the NEXT action): running ⏳ fork working · discussing 💬 · answer ❓ · review 👀 · apply 📥 · test 🧪 · commit ✅ · branch 🌿. Notes and table text: under 60 characters, no paths, no backticks.`;

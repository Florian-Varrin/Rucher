export const INSTRUCTIONS = `Carnet tracks the status of sub-agents (forks) for the human, in a shared database. Views are rendered by the \`rucher\` CLI.

Rules:
- Never write status files (agents-status.md or similar) and never describe status updates in the chat. When a fork finishes, the main agent says only "<name> finished, report ready".
- Update BEFORE and AFTER each piece of work, never batched at the end of a turn.
- Your session is resolved automatically. Pass \`session\` only to target another session.

Main agent:
- agent_start before dispatching a fork (name, task), in an earlier message than the launch. Launch it with the agent name as the Agent description and a prompt starting with "You are fork \`<name>\`." Names are short, no paths.
- table_set with main_working=true before applying, testing or fixing yourself; table_set with a status (or table_clear) when done.
- log_event when a step is answered, applied, tested, committed or dropped.
- When a fork finishes: say one line "<name> finished, report ready", copy its report to the report destination agent_start gave (.rucher/reports/<name>.md in the group meta directory) and call agent_update with that report_path. Present the report only when asked.
- For dispatching, applying or reviewing forks, load the rucher skill: it holds the full workflow.
- agent_drop when a fork's work is committed or abandoned. queue_reorder to change the handling order.
- agent_list to recall where things stand.
- Memory: note_add at the end of a step for what was learned, decided or ruled out (repos only when it applies to some); note_drop with the reason when a note proves wrong; promote the Learnings of fork reports.
- Sessions: session_new when the human names this session (then ask them to /rename it the same way); session_list, session_resume_info and log_read to recall other sessions or the journal; session_drop only when the human asks.

Forks:
- agent_update (status running, short note) at meaningful progress.
- agent_done with the report path as your LAST tool action; has_questions=true when the report asks the human something. Then reply with one line only: the report holds the detail.
- Never agent_start, never table_set, never note_add: end the report with a Learnings section instead. Both roles: note_cite when a note changed what you did.

Statuses (emoji shown to the human = the NEXT action): running ⏳ fork working · discussing 💬 · answer ❓ human must answer · review 👀 human must review · apply 📥 · test 🧪 · commit ✅ · branch 🌿. Only the human applies, tests and commits.

Notes and table text: under 60 characters, no paths, no backticks.`;

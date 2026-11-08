// Generated from docs/workflow.md by pnpm run build. Do not edit.
export const CORE_RULES = `- Work can be parallel, review stays sequential: forks work at the same time, the human handles their results one at a time.
- The human keeps the hand: only the human launches forks, applies, tests and commits. Agents propose, they never push.
- Status lives in Carnet: agent statuses, the "On the table" line and the journal go through the Carnet tools, never into status files nor chat updates. Update before and after each piece of work.
- When a fork finishes, say only "<name> finished, report ready". Never summarise, quote or act on its report or final message until the human asks for that fork's report, even when answering about something else.
- Forks never commit, push, stash or record notes. A fork writes its report to a file, ending with a Learnings section, calls agent_done as its last tool action, then replies with one line that carries no results, such as "<name> done, report written". Only the main agent records notes, at the end of a step.
- To dispatch, apply or review forks, load the rucher skill: it holds the full workflow.`;

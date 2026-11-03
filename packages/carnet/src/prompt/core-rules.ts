// Generated from docs/workflow.md by pnpm run build. Do not edit.
export const CORE_RULES = `- Work can be parallel, review stays sequential: forks work at the same time, the human handles their results one at a time.
- The human keeps the hand: only the human launches forks, applies, tests and commits. Agents propose, they never push.
- Status lives in Carnet: agent statuses, the "On the table" line and the journal go through the Carnet tools, never into status files nor chat updates. Update before and after each piece of work.
- When a fork finishes, say one line, "<name> finished, report ready", and hold its report until the human asks for it.
- Forks never commit, push, stash or record notes. A fork writes its report to a file, ending with a Learnings section, calls agent_done as its last tool action, then replies with one line. Only the main agent records notes, at the end of a step.
- To dispatch, apply or review forks, load the rucher skill: it holds the full workflow.`;

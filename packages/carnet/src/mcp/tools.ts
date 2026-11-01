import * as z from 'zod/v4';
import type { Carnet } from '../carnet.ts';
import { EVENT_TYPES } from '../events.ts';
import { formatEventLine, resumeContext, sessionLabel } from '../resume.ts';
import { EMOJI, OPEN_AGENT_STATUSES, USER_ACTION_STATUSES } from '../status/model.ts';
import { renderAgentLine, renderTableLine } from '../status/render.ts';

export interface ToolOutput {
  text: string;
  data?: Record<string, unknown>;
}

export interface ToolDefinition<Schema extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  schema: Schema;
  run: (carnet: Carnet, sessionId: string, args: z.infer<Schema>) => ToolOutput;
}

function defineTool<Schema extends z.ZodObject>(
  definition: ToolDefinition<Schema>,
): ToolDefinition<Schema> {
  return definition;
}

const session = z
  .string()
  .optional()
  .describe('Session to target (name, id or id prefix). Omit for the current session.');

const agentName = z.string().min(1).describe('Short agent name, no paths');

const agentStart = defineTool({
  name: 'agent_start',
  description:
    'Main agent only. Register a fork right before dispatching it. The agent appears as ⏳ running and a `started` event is logged.',
  schema: z.object({
    name: agentName,
    task: z.string().min(1).describe('One-line task given to the fork'),
    base_commit: z.string().optional().describe('Commit the fork starts from'),
    worktree: z.string().optional().describe('Worktree path when the fork has one'),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const agent = carnet.agents.start(sessionId, {
      name: args.name,
      task: args.task,
      baseCommit: args.base_commit,
      worktree: args.worktree,
    });
    return { text: `${EMOJI.running} ${agent.name} started`, data: { agent } };
  },
});

const agentUpdate = defineTool({
  name: 'agent_update',
  description:
    "Change an agent's status and displayed note. Forks use it with status `running` to show progress; the main agent uses user-action statuses (discussing, answer, review, apply, test, commit, branch) as the next step moves, and sets report_path after copying a report to its final place. Use agent_drop to close.",
  schema: z.object({
    name: agentName,
    status: z.enum(OPEN_AGENT_STATUSES).describe('Next action: running means the fork is working'),
    note: z.string().optional().describe('Under 60 characters, no paths, no backticks'),
    report_path: z.string().optional().describe('New absolute path of the report, when it moved'),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const agent = carnet.agents.update(sessionId, args.name, {
      status: args.status,
      note: args.note,
      reportPath: args.report_path,
    });
    const text = renderAgentLine({
      name: agent.name,
      status: agent.status,
      emoji: agent.status === 'closed' ? '' : EMOJI[agent.status],
      note: agent.note,
    });
    return { text, data: { agent } };
  },
});

const agentDone = defineTool({
  name: 'agent_done',
  description:
    'Forks call this as their LAST action. Records the report path and moves the agent to ❓ answer (has_questions=true) or 👀 review. Logs a `finished` event.',
  schema: z.object({
    name: agentName,
    report_path: z.string().min(1).describe('Absolute path of the markdown report'),
    has_questions: z.boolean().describe('true when the report asks the human something'),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const agent = carnet.agents.finish(sessionId, args.name, {
      reportPath: args.report_path,
      hasQuestions: args.has_questions,
    });
    const text = args.has_questions
      ? `${EMOJI.answer} ${agent.name} needs answers`
      : `${EMOJI.review} ${agent.name} ready for review`;
    return { text, data: { agent } };
  },
});

const agentDrop = defineTool({
  name: 'agent_drop',
  description:
    'Main agent only. Close an agent once its work is committed or abandoned. It leaves the status view; history stays in the journal.',
  schema: z.object({
    name: agentName,
    reason: z.string().optional().describe('Why it is closed, for the journal'),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const agent = carnet.agents.drop(sessionId, args.name, args.reason);
    return { text: `${agent.name} closed`, data: { agent } };
  },
});

const agentList = defineTool({
  name: 'agent_list',
  description: 'List the open agents of the session with status, note, task and report path.',
  schema: z.object({ session }),
  run: (carnet, sessionId) => {
    const agents = carnet.agents.list(sessionId);
    const lines = agents.map((agent) => {
      const emoji = agent.status === 'closed' ? '' : EMOJI[agent.status];
      const note = agent.note ? ` — ${agent.note}` : '';
      const report = agent.reportPath ? ` (report: ${agent.reportPath})` : '';
      return `${emoji} ${agent.name} [${agent.status}]${note}${report}`;
    });
    return { text: lines.length ? lines.join('\n') : 'no open agents', data: { agents } };
  },
});

const queueReorder = defineTool({
  name: 'queue_reorder',
  description:
    "Main agent only. Set the order of the 'Waiting on you' list. Named agents come first in the given order, the others follow the default order (answer, review, rest).",
  schema: z.object({
    names: z.array(agentName).min(1).describe('Agent names in handling order'),
    session,
  }),
  run: (carnet, sessionId, args) => {
    carnet.agents.reorderQueue(sessionId, args.names);
    const view = carnet.status.view(carnet.sessions.require(sessionId));
    const order = view.waiting.map((line) => line.name).join(', ');
    return {
      text: order ? `Waiting order: ${order}` : 'nothing waiting',
      data: { waiting: view.waiting },
    };
  },
});

const tableSet = defineTool({
  name: 'table_set',
  description:
    "Main agent only. Set the 'On the table' line: what the main agent is handling now. main_working=true while you apply, test or fix yourself (shown ⚙️, not ready for the human). Otherwise give the status of the next human action.",
  schema: z.object({
    text: z.string().min(1).describe('Under 60 characters, no paths, no backticks'),
    main_working: z.boolean().describe('true while the main agent itself is working on it'),
    status: z
      .enum(USER_ACTION_STATUSES)
      .optional()
      .describe('Next human action when main_working is false; defaults to discussing'),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const item = carnet.table.set(sessionId, {
      text: args.text,
      mainWorking: args.main_working,
      status: args.status,
    });
    return { text: renderTableLine(item), data: { table: item } };
  },
});

const tableClear = defineTool({
  name: 'table_clear',
  description: "Main agent only. Empty the 'On the table' line.",
  schema: z.object({ session }),
  run: (carnet, sessionId) => {
    carnet.table.clear(sessionId);
    return { text: 'On the table cleared' };
  },
});

const logEvent = defineTool({
  name: 'log_event',
  description:
    "Append a journal event: started, finished, answered, applied, tested, committed, dropped. agent_start, agent_done and agent_drop already log theirs; use this for the human's steps (answered, applied, tested, committed).",
  schema: z.object({
    type: z.enum(EVENT_TYPES),
    agent: z.string().optional().describe('Agent concerned'),
    commit: z.string().optional().describe('Commit sha'),
    link: z.string().optional().describe('Report path or URL'),
    note: z.string().optional(),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const event = carnet.events.log(sessionId, {
      type: args.type,
      agent: args.agent,
      commit: args.commit,
      link: args.link,
      note: args.note,
    });
    const parts = ['logged', event.type, event.agent, event.commit].filter(Boolean);
    return { text: parts.join(' '), data: { event } };
  },
});

const sessionName = z.string().trim().min(1).describe('Short session name, used by rucher resume');

const sessionNew = defineTool({
  name: 'session_new',
  description:
    'Name the current session (or rename it) so it can be resumed later with `rucher resume <name>`. Promotes a temporary session to active.',
  schema: z.object({
    name: sessionName,
    purpose: z.string().optional().describe('One line: what this session is for'),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const named = carnet.sessions.name(sessionId, args.name, args.purpose);
    return {
      text: `Session named ${named.name}. Ask the human to run /rename ${named.name} in Claude Code so the titles match.`,
      data: { session: named },
    };
  },
});

const sessionList = defineTool({
  name: 'session_list',
  description:
    "List the group's sessions, most recently active first. Temporary and dropped ones are hidden unless asked.",
  schema: z.object({
    include_temporary: z.boolean().optional(),
    include_dropped: z.boolean().optional(),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const sessions = carnet.sessions.list({
      includeTemporary: args.include_temporary,
      includeDropped: args.include_dropped,
    });
    const lines = sessions.map((listed) => {
      const current = listed.id === sessionId ? ' (current)' : '';
      return `${sessionLabel(listed)} [${listed.status}]${current}`;
    });
    return { text: lines.length ? lines.join('\n') : 'no sessions', data: { sessions } };
  },
});

const sessionDrop = defineTool({
  name: 'session_drop',
  description:
    'Main agent only. Drop a session by name, id or id prefix: its open agents are closed and it leaves the lists. History stays in the journal.',
  schema: z.object({
    name: z.string().trim().min(1).describe('Session name, id or id prefix'),
    session,
  }),
  run: (carnet, _sessionId, args) => {
    const dropped = carnet.sessions.drop(carnet.sessions.find(args.name).id);
    return { text: `Session ${sessionLabel(dropped)} dropped`, data: { session: dropped } };
  },
});

const sessionResumeInfo = defineTool({
  name: 'session_resume_info',
  description:
    'What a session was doing: its status view and last events, plus the command to resume it. Defaults to the current session.',
  schema: z.object({
    name: z.string().trim().min(1).optional().describe('Session name, id or id prefix'),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const target = args.name ? carnet.sessions.find(args.name) : carnet.sessions.require(sessionId);
    const resume = target.name ? `rucher resume ${target.name}` : `claude --resume ${target.id}`;
    return {
      text: `${resumeContext(carnet, target)}\n\nResume with: ${resume}`,
      data: { session: target, resume },
    };
  },
});

const logRead = defineTool({
  name: 'log_read',
  description: 'Read the last journal events of the session, oldest first.',
  schema: z.object({
    limit: z.number().int().min(1).max(200).optional().describe('Number of events, default 20'),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const events = carnet.events.read(sessionId, args.limit ?? 20);
    return {
      text: events.length ? events.map(formatEventLine).join('\n') : 'no events yet',
      data: { events },
    };
  },
});

export const TOOLS: readonly ToolDefinition[] = [
  agentStart,
  agentUpdate,
  agentDone,
  agentDrop,
  agentList,
  queueReorder,
  tableSet,
  tableClear,
  logEvent,
  logRead,
  sessionNew,
  sessionList,
  sessionDrop,
  sessionResumeInfo,
] as readonly ToolDefinition[];

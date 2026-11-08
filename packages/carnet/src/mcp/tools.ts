import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as z from 'zod/v4';
import type { Carnet } from '../carnet.ts';
import { EVENT_TYPES } from '../events.ts';
import { reportPath, reportsDirectory } from '../paths.ts';
import { hostById } from '../hosts/host.ts';
import { memoryHalfLife, type Note, NOTE_KINDS } from '../notes.ts';
import { formatEventLine, resumeContext, sessionLabel } from '../resume.ts';
import { EMOJI, OPEN_AGENT_STATUSES, USER_ACTION_STATUSES } from '../status/model.ts';
import { renderAgentLine, renderTableLine } from '../status/render.ts';
import { AGENT_STEPS, stepAgent } from '../steps.ts';

export interface ToolOutput {
  text: string;
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
    'Main agent only. Register a fork before dispatching it (launch it in a later message). Logs `started`. The result gives the report destination in the workspace, where agent_done copies the report.',
  schema: z.object({
    name: agentName,
    task: z.string().min(1).describe('One-line task given to the fork'),
    base_commit: z.string().optional().describe('Commit the fork starts from'),
    worktree: z.string().optional().describe('Worktree path when the fork has one'),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const workspace = carnet.workspace;
    const agent = carnet.agents.start(sessionId, {
      name: args.name,
      task: args.task,
      baseCommit: args.base_commit,
      worktree: args.worktree,
    });
    if (!workspace) {
      return {
        text: `${EMOJI.running} ${agent.name} started outside any workspace\nNo report destination: the report stays where the fork writes it`,
      };
    }
    mkdirSync(reportsDirectory(workspace), { recursive: true });
    return {
      text: `${EMOJI.running} ${agent.name} started in workspace ${workspace.name}\nReport destination: ${reportPath(workspace, agent.name)}`,
    };
  },
});

const agentUpdate = defineTool({
  name: 'agent_update',
  description:
    "Set an agent's status and note. Forks: status running at progress. Main agent: only for moves agent_step does not cover.",
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
    return { text };
  },
});

function copyReport(carnet: Carnet, name: string, reportFile: string): string {
  if (!carnet.workspace) return reportFile;
  const destination = reportPath(carnet.workspace, name);
  if (resolve(reportFile) === destination || !existsSync(reportFile)) return reportFile;
  mkdirSync(reportsDirectory(carnet.workspace), { recursive: true });
  copyFileSync(reportFile, destination);
  return destination;
}

const agentDone = defineTool({
  name: 'agent_done',
  description:
    'Forks call this as their LAST tool action, then reply with one line that carries no results. Copies the report to the workspace report destination and marks the agent ❓ answer (has_questions) or 👀 review once the fork stops.',
  schema: z.object({
    name: agentName,
    report_path: z.string().min(1).describe('Absolute path of the markdown report'),
    has_questions: z.boolean().describe('true when the report asks the human something'),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const agent = carnet.agents.finish(sessionId, args.name, {
      reportPath: copyReport(carnet, args.name, args.report_path),
      hasQuestions: args.has_questions,
    });
    const outcome = args.has_questions
      ? `${EMOJI.answer} ${agent.name} needs answers`
      : `${EMOJI.review} ${agent.name} ready for review`;
    const text =
      agent.status === 'running'
        ? `${outcome} once you stop; reply now with one line that carries no results`
        : outcome;
    return { text };
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
    return { text: `${agent.name} closed` };
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
    return { text: lines.length ? lines.join('\n') : 'no open agents' };
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
    };
  },
});

const tableSet = defineTool({
  name: 'table_set',
  description:
    "Main agent only. Set the 'On the table' line: what the main agent is handling now. main_working=true while you work yourself (⚙️); otherwise the status of the next human action.",
  schema: z.object({
    text: z.string().min(1).describe('Under 60 characters, no paths, no backticks'),
    main_working: z
      .boolean()
      .optional()
      .describe('Omitted: false when a status is given, else unchanged'),
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
    return { text: renderTableLine(item) };
  },
});

const agentStep = defineTool({
  name: 'agent_step',
  description:
    "Main agent only. One call per step of a fork's work: logs the event, moves the agent to the next human action and keeps the 'On the table' line in sync. answered → apply, applying → ⚙️ table line, applied → test, tested → commit, committed (commit required) → closed, dropped (note = reason) → closed.",
  schema: z.object({
    name: agentName,
    step: z.enum(AGENT_STEPS),
    commit: z.string().optional().describe('Commit sha, for committed'),
    note: z.string().optional().describe('Short note for the journal; the reason for dropped'),
    next: z
      .enum(OPEN_AGENT_STATUSES)
      .optional()
      .describe('Override the next status, e.g. running when the fork resumes'),
    session,
  }),
  run: (carnet, sessionId, args) => ({ text: stepAgent(carnet, sessionId, args) }),
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
    'Append a journal event. agent_start, agent_done, agent_drop and agent_step already log theirs: use this only for events outside them.',
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
    return { text: parts.join(' ') };
  },
});

const sessionName = z.string().trim().min(1).describe('Short session name, used by rucher resume');

const sessionNew = defineTool({
  name: 'session_new',
  description:
    'Name the current session (or rename it) so it can be resumed later with `rucher resume <name>`. Makes it an active session, kept by the cleanups.',
  schema: z.object({
    name: sessionName,
    purpose: z.string().optional().describe('One line: what this session is for'),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const named = carnet.sessions.name(sessionId, args.name, args.purpose);
    return {
      text: `Session named ${named.name}. ${hostById(named.host).renameInstruction(named.name ?? args.name)}`,
    };
  },
});

const sessionList = defineTool({
  name: 'session_list',
  description:
    "List the workspace's sessions, most recently active first. Temp and archived ones are hidden unless asked.",
  schema: z.object({
    include_temp: z.boolean().optional(),
    include_archived: z.boolean().optional(),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const sessions = carnet.sessions.list({
      includeTemp: args.include_temp,
      includeArchived: args.include_archived,
    });
    const lines = sessions.map((listed) => {
      const current = listed.id === sessionId ? ' (current)' : '';
      return `${sessionLabel(listed)} [${listed.kind}, ${listed.status}]${current}`;
    });
    return { text: lines.length ? lines.join('\n') : 'no sessions' };
  },
});

const sessionDrop = defineTool({
  name: 'session_drop',
  description:
    'Main agent only. Archive a session by name, id or id prefix: its open agents are closed and it leaves the lists. History stays in the journal.',
  schema: z.object({
    name: z.string().trim().min(1).describe('Session name, id or id prefix'),
    session,
  }),
  run: (carnet, _sessionId, args) => {
    const dropped = carnet.sessions.drop(carnet.sessions.find(args.name).id);
    return { text: `Session ${sessionLabel(dropped)} archived` };
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
    const resume = `rucher resume ${target.name ?? target.id}`;
    return {
      text: `${resumeContext(carnet, target)}\n\nResume with: ${resume}`,
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
    };
  },
});

const noteId = z.number().int().positive().describe('Note id, as shown by note_list (#14 is 14)');

export function noteLine(note: Note): string {
  const repos = note.repos.length ? ` [${note.repos.join(', ')}]` : '';
  return `#${note.id} ${note.kind}${repos} ${note.text}`;
}

const noteAdd = defineTool({
  name: 'note_add',
  description:
    "Main agent only. Record what the workspace learned (learning), decided (decision) or tried and gave up (dead_end), at the end of a step. One claim under 200 characters with its reason, no markdown. `repos` only when it applies to some of the workspace's repos; omit it for a general note. A result listing similar notes means a likely duplicate: drop or replace instead of piling up.",
  schema: z.object({
    kind: z.enum(NOTE_KINDS),
    text: z.string().min(1).describe('One claim with its reason, under 200 characters'),
    repos: z
      .array(z.string().min(1))
      .optional()
      .describe('Repo names of the workspace; omit for a general note'),
    agent: z.string().optional().describe('Fork the note comes from'),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const { note, similar } = carnet.notes.add({
      kind: args.kind,
      text: args.text,
      repos: args.repos,
      agent: args.agent,
      session: sessionId,
    });
    const warning = similar.length
      ? `\nSimilar active notes, possible duplicate:\n${similar.map(noteLine).join('\n')}`
      : '';
    return { text: `added ${noteLine(note)}${warning}` };
  },
});

const noteList = defineTool({
  name: 'note_list',
  description:
    "The workspace's active notes, dead ends first, then decisions, then learnings, most cited first. Filter by kind, repo, general (notes without repo) or a substring query. Check it before trying an approach.",
  schema: z.object({
    kind: z.enum(NOTE_KINDS).optional(),
    repo: z.string().optional().describe('Notes of this repo'),
    general: z.boolean().optional().describe('Only notes without repo'),
    query: z.string().optional().describe('Substring of the text'),
    include_dropped: z.boolean().optional(),
    session,
  }),
  run: (carnet, _sessionId, args) => {
    const notes = carnet.notes.list({
      kind: args.kind,
      repo: args.repo,
      general: args.general,
      query: args.query,
      includeDropped: args.include_dropped,
      halfLifeDays: memoryHalfLife(process.env['RUCHER_MEMORY_HALF_LIFE_DAYS']),
    });
    const lines = notes.map(
      (note) => `${noteLine(note)}${note.droppedAt ? ` (dropped: ${note.droppedReason})` : ''}`,
    );
    return { text: lines.length ? lines.join('\n') : 'no notes' };
  },
});

const noteDrop = defineTool({
  name: 'note_drop',
  description:
    'Main agent only. Close a note that proved wrong or outdated: it stays in the history, marked dropped with the reason. Pass replaced_by when a corrected note replaces it.',
  schema: z.object({
    id: noteId,
    reason: z.string().min(1).describe('Why the note is no longer true'),
    replaced_by: z.number().int().positive().optional().describe('Id of the note replacing it'),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const note = carnet.notes.drop(args.id, {
      reason: args.reason,
      replacedBy: args.replaced_by,
      session: sessionId,
    });
    const replaced = note.replacedBy ? `, replaced by #${note.replacedBy}` : '';
    return { text: `dropped #${note.id}${replaced}` };
  },
});

const noteCite = defineTool({
  name: 'note_cite',
  description:
    'Cite a note that changed what you did (avoided, followed or adjusted something), with what it changed. Never for a plain read. Citations decide which notes come first.',
  schema: z.object({
    id: noteId,
    why: z.string().min(1).describe('What the note changed, short'),
    agent: z.string().optional().describe('Fork citing it, when not the main agent'),
    session,
  }),
  run: (carnet, sessionId, args) => {
    const citation = carnet.notes.cite(args.id, {
      why: args.why,
      agent: args.agent,
      session: sessionId,
    });
    return { text: `cited #${citation.note}: ${citation.why}` };
  },
});

export const TOOLS: readonly ToolDefinition[] = [
  agentStart,
  agentUpdate,
  agentDone,
  agentDrop,
  agentStep,
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
  noteAdd,
  noteList,
  noteDrop,
  noteCite,
] as readonly ToolDefinition[];

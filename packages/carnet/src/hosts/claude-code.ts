import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Group } from '../group/locate.ts';
import type {
  ContextFile,
  ContextFileResult,
  Host,
  HostPromptPayload,
  HostSessionEndPayload,
  HostSessionPayload,
  HostSubagentPayload,
  LaunchOptions,
} from './host.ts';

const TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const TITLE_PATTERN = /"type":"custom-title","customTitle":("(?:[^"\\]|\\.)*")/g;
const FORK_NAME_PATTERN = /You are fork `([^`]+)`/;

export const REPOS_START = '<!-- rucher:repos start -->';
export const REPOS_END = '<!-- rucher:repos end -->';

function payloadObject(json: string): Record<string, unknown> {
  const data = JSON.parse(json) as Record<string, unknown>;
  if (typeof data.session_id !== 'string' || !data.session_id) {
    throw new TypeError('Hook payload has no session_id');
  }
  return data;
}

function text(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' ? value : undefined;
}

function ownTaskDescription(data: Record<string, unknown>, agentId: string): string | undefined {
  const tasks = data.background_tasks;
  if (!Array.isArray(tasks)) return undefined;
  const own = tasks.find(
    (task): task is Record<string, unknown> =>
      typeof task === 'object' && task !== null && (task as Record<string, unknown>).id === agentId,
  );
  return own ? text(own, 'description') : undefined;
}

function subagentMetadataDescription(transcriptPath: string): string | undefined {
  try {
    const metadata = JSON.parse(
      readFileSync(transcriptPath.replace(/\.jsonl$/, '.meta.json'), 'utf8'),
    ) as Record<string, unknown>;
    return text(metadata, 'description');
  } catch {
    return undefined;
  }
}

function subagentPromptName(transcriptPath: string): string | undefined {
  try {
    const firstLine = readFileSync(transcriptPath, 'utf8').split('\n', 1)[0] ?? '';
    return FORK_NAME_PATTERN.exec(firstLine)?.[1];
  } catch {
    return undefined;
  }
}

export function transcriptTitle(path: string): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, 'r');
    const size = fstatSync(descriptor).size;
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, size - length);
    const matches = [...buffer.toString('utf8').matchAll(TITLE_PATTERN)];
    const last = matches.at(-1)?.[1];
    return last === undefined ? undefined : (JSON.parse(last) as string);
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function reposBlock(group: Group): string {
  const repos = group.repos.length
    ? group.repos.map((repo) => `- \`${basename(repo)}\`: ${repo}`).join('\n')
    : '- (none yet: `rucher group add <path>`)';
  return `${REPOS_START}\n## Repos\n\n${repos}\n${REPOS_END}`;
}

export function replaceReposBlock(content: string, group: Group): string | null {
  const start = content.indexOf(REPOS_START);
  const end = content.indexOf(REPOS_END);
  if (start === -1 || end === -1 || end < start) return null;
  return content.slice(0, start) + reposBlock(group) + content.slice(end + REPOS_END.length);
}

export function groupInstructions(group: Group): string {
  return `# ${group.name}

Meta directory of the ${group.name} group: context only, the repos live at their own paths below and are reachable through \`.claude/settings.json\`. Start Claude Code sessions here.

${reposBlock(group)}

## Multi-agent work

Use the rucher tools (Carnet) for agent statuses and the journal, and the rucher skill for the workflow.

## Shared instructions

(what every session of this group should know)
`;
}

export function groupSettings(group: Group): string {
  return `${JSON.stringify({ permissions: { additionalDirectories: group.repos } }, null, 2)}\n`;
}

interface Settings {
  permissions?: { additionalDirectories?: string[] } & Record<string, unknown>;
  [key: string]: unknown;
}

const instructionsFile: ContextFile = {
  path: 'CLAUDE.md',
  sync(group): ContextFileResult {
    const path = join(group.root, 'CLAUDE.md');
    if (!existsSync(path)) {
      writeFileSync(path, groupInstructions(group));
      return 'written';
    }
    const content = readFileSync(path, 'utf8');
    const next = replaceReposBlock(content, group);
    if (next === null) return 'no-markers';
    if (next === content) return 'unchanged';
    writeFileSync(path, next);
    return 'updated';
  },
};

const settingsFile: ContextFile = {
  path: '.claude/settings.json',
  sync(group, mode): ContextFileResult {
    const path = join(group.root, '.claude', 'settings.json');
    if (!existsSync(path)) {
      if (group.repos.length === 0) return 'unchanged';
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, groupSettings(group));
      return 'written';
    }
    const settings = JSON.parse(readFileSync(path, 'utf8')) as Settings;
    const current = settings.permissions?.additionalDirectories ?? [];
    const next =
      mode === 'exact'
        ? group.repos
        : [...current, ...group.repos.filter((repo) => !current.includes(repo))];
    if (next.length === current.length && next.every((repo, index) => repo === current[index])) {
      return 'unchanged';
    }
    settings.permissions = { ...settings.permissions, additionalDirectories: next };
    writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
    return 'updated';
  },
};

function launchArguments(options: LaunchOptions = {}): string[] {
  return [
    ...(options.name ? ['--name', options.name] : []),
    ...(options.appendPromptFile ? ['--append-system-prompt-file', options.appendPromptFile] : []),
    ...(options.passthrough ?? []),
  ];
}

export const claudeCode: Host = {
  id: 'claude-code',
  displayName: 'Claude Code',
  processId(env) {
    const processId = Number(env.CLAUDE_PID);
    return Number.isInteger(processId) && processId > 0 ? processId : null;
  },
  sessionIdFromEnvironment(env) {
    return env.CLAUDE_CODE_SESSION_ID || undefined;
  },
  projectDirectory(env) {
    return env.CLAUDE_PROJECT_DIR || undefined;
  },
  parseSessionPayload(json): HostSessionPayload {
    const data = payloadObject(json);
    return {
      session_id: data.session_id as string,
      cwd: text(data, 'cwd'),
      source: text(data, 'source'),
      session_title: text(data, 'session_title'),
    };
  },
  parsePromptPayload(json): HostPromptPayload {
    const data = payloadObject(json);
    return {
      session_id: data.session_id as string,
      cwd: text(data, 'cwd'),
      session_title: text(data, 'session_title'),
      transcript_path: text(data, 'transcript_path'),
    };
  },
  parseSubagentPayload(json): HostSubagentPayload {
    const data = payloadObject(json);
    const agentId = text(data, 'agent_id');
    if (!agentId) throw new TypeError('Hook payload has no agent_id');
    return {
      session_id: data.session_id as string,
      agent_id: agentId,
      agent_type: text(data, 'agent_type'),
      cwd: text(data, 'cwd'),
      description: ownTaskDescription(data, agentId),
      agent_transcript_path: text(data, 'agent_transcript_path'),
    };
  },
  parseSessionEndPayload(json): HostSessionEndPayload {
    const data = payloadObject(json);
    return {
      session_id: data.session_id as string,
      cwd: text(data, 'cwd'),
      reason: text(data, 'reason'),
    };
  },
  subagentNames(payload) {
    const transcript = payload.agent_transcript_path;
    const candidates = [
      payload.description,
      transcript && subagentMetadataDescription(transcript),
      transcript && subagentPromptName(transcript),
    ];
    return [...new Set(candidates.filter((name): name is string => Boolean(name)))];
  },
  // `/rename` fires no hook of its own; the next prompt carries the new title.
  promptTitle(payload) {
    return (
      payload.session_title ??
      (payload.transcript_path ? transcriptTitle(payload.transcript_path) : undefined)
    );
  },
  launchCommand(sessionId, options) {
    return { command: 'claude', args: ['--session-id', sessionId, ...launchArguments(options)] };
  },
  resumeCommand(session, options) {
    return {
      command: 'claude',
      args: ['--resume', session.id, ...launchArguments({ name: session.name, ...options })],
    };
  },
  forkCommand(parent, options) {
    return {
      command: 'claude',
      args: ['--resume', parent.id, '--fork-session', ...launchArguments(options)],
    };
  },
  renameInstruction(name) {
    return `Ask the human to run /rename ${name} in Claude Code so the titles match.`;
  },
  contextFiles: [settingsFile, instructionsFile],
};

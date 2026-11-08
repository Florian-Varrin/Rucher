import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  AGENTS_FILE,
  type Workspace,
  INSTRUCTIONS_FILE,
  definitionInstructions,
} from '../workspace/workspace.ts';
import { PROMPT_FILE } from '../prompt/prompt.ts';
import {
  GENERATED_MARKER,
  markdownCopy,
  mergeSettings,
  removeStaleCopies,
  writeGenerated,
} from '../run-directory-files.ts';
import type {
  Host,
  HostRender,
  HostPromptPayload,
  HostSessionEndPayload,
  HostToolPayload,
  HostSessionPayload,
  HostSubagentPayload,
  LaunchOptions,
} from './host.ts';

const TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const TITLE_PATTERN = /"type":"custom-title","customTitle":("(?:[^"\\]|\\.)*")/g;
const FORK_NAME_PATTERN = /You are fork `([^`]+)`/;

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

// Bash commands are not parsed: their cwd is the only reliable path.
function touchedPath(
  toolName: string | undefined,
  input: unknown,
  cwd: string | undefined,
): string | undefined {
  const fields =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  if (toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') {
    return text(fields, 'file_path');
  }
  if (toolName === 'Grep' || toolName === 'Glob') return text(fields, 'path') ?? cwd;
  if (toolName === 'Bash') return cwd;
  return undefined;
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

const SETTINGS_FILE = join('.claude', 'settings.json');
const BACKEND_NOTES = 'backends/claude.md';

// Instruction files are copied, not linked: an @ import inside a link resolves next to its target,
// outside the run directory, where Claude Code skips it without approval.
export function instructionFiles(workspace: Workspace): string[] {
  if (!existsSync(workspace.definition)) return [];
  return readdirSync(workspace.definition, { withFileTypes: true })
    .filter((item) => item.isFile() && item.name.endsWith('.md') && item.name !== PROMPT_FILE)
    .map((item) => item.name)
    .sort();
}

function repoAgentsImports(workspace: Workspace): string[] {
  return workspace.repos
    .filter(
      (repo) =>
        existsSync(join(repo.path, AGENTS_FILE)) &&
        !existsSync(join(repo.path, INSTRUCTIONS_FILE)) &&
        !existsSync(join(repo.path, '.claude', INSTRUCTIONS_FILE)),
    )
    .map((repo) => `@${join(repo.path, AGENTS_FILE)}`);
}

// Claude Code has no reliable native AGENTS.md loading, so a generated CLAUDE.md imports it.
function runDirectoryCopies(workspace: Workspace): Map<string, string> {
  const agents = definitionInstructions(workspace) === AGENTS_FILE;
  const read = (name: string) => readFileSync(join(workspace.definition, name), 'utf8');
  const copies = new Map(
    instructionFiles(workspace).map((name) => [name, markdownCopy(read(name))]),
  );
  if (!agents) return copies;
  const imports = [`@${AGENTS_FILE}`];
  if (existsSync(join(workspace.definition, BACKEND_NOTES))) {
    copies.set(BACKEND_NOTES, markdownCopy(read(BACKEND_NOTES)));
    imports.push(`@${BACKEND_NOTES}`);
  }
  imports.push(...repoAgentsImports(workspace));
  copies.set(INSTRUCTIONS_FILE, markdownCopy(`${imports.join('\n')}\n`));
  return copies;
}

export function workspaceSettings(workspace: Workspace): Record<string, unknown> {
  return mergeSettings(
    {
      '//': GENERATED_MARKER,
      permissions: {
        additionalDirectories: workspace.repos.map((repo) => repo.path),
        // The copies are rewritten on every render: instructions are edited in the definition.
        deny: [...runDirectoryCopies(workspace).keys()].sort().map((name) => `Edit(/${name})`),
      },
    },
    workspace.backends['claude-code']?.settings ?? {},
  );
}

function removeStaleBackendNotes(workspace: Workspace, keep: ReadonlySet<string>): string[] {
  const directory = join(workspace.runDirectory, dirname(BACKEND_NOTES));
  const removed = removeStaleCopies(
    directory,
    new Set(
      [...keep]
        .filter((name) => dirname(name) === dirname(BACKEND_NOTES))
        .map((name) => basename(name)),
    ),
  );
  if (existsSync(directory) && readdirSync(directory).length === 0) rmdirSync(directory);
  return removed.map((name) => join(dirname(BACKEND_NOTES), name));
}

function renderClaudeRunDirectory(workspace: Workspace): HostRender {
  const rendered: HostRender = { written: [], removed: [] };
  const copies = runDirectoryCopies(workspace);
  for (const [name, content] of [...copies].sort(([a], [b]) => a.localeCompare(b))) {
    if (writeGenerated(join(workspace.runDirectory, name), content)) rendered.written.push(name);
  }
  const names = new Set(copies.keys());
  rendered.removed.push(...removeStaleCopies(workspace.runDirectory, names));
  rendered.removed.push(...removeStaleBackendNotes(workspace, names));
  const settings = `${JSON.stringify(workspaceSettings(workspace), null, 2)}\n`;
  if (writeGenerated(join(workspace.runDirectory, SETTINGS_FILE), settings)) {
    rendered.written.push(SETTINGS_FILE);
  }
  return rendered;
}

function launchArguments(options: LaunchOptions = {}): string[] {
  return [
    ...(options.name ? ['--name', options.name] : []),
    ...(options.appendPromptFile ? ['--append-system-prompt-file', options.appendPromptFile] : []),
    ...(options.directories ?? []).flatMap((directory) => ['--add-dir', directory]),
    ...(options.passthrough ?? []),
  ];
}

const RENDERING_SOURCES = new Set(['startup', 'clear', 'compact', 'fork']);

function projectsDirectory(env: NodeJS.ProcessEnv): string {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
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
  parseToolPayload(json): HostToolPayload {
    const data = payloadObject(json);
    const toolName = text(data, 'tool_name');
    const cwd = text(data, 'cwd');
    return {
      session_id: data.session_id as string,
      cwd,
      tool_name: toolName,
      agent_id: text(data, 'agent_id'),
      path: touchedPath(toolName, data.tool_input, cwd),
    };
  },
  subagentInheritsContext(payload) {
    return payload.agent_type === 'fork';
  },
  // The system prompt is rendered again on these sources and kept as is on resume.
  rendersSystemPrompt(source) {
    return RENDERING_SOURCES.has(source);
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
  // Claude Code keeps each conversation under a project directory derived from its cwd.
  transcriptFiles(session, env = process.env) {
    if (!session.cwd) return [];
    const project = join(projectsDirectory(env), session.cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    return [join(project, `${session.id}.jsonl`), join(project, session.id)].filter((path) =>
      existsSync(path),
    );
  },
  // Claude Code writes no transcript before the first message. Every project directory is
  // searched, so a conversation filed under another cwd is never shadowed by a fresh one.
  hasConversation(session, env = process.env) {
    const projects = projectsDirectory(env);
    if (!existsSync(projects)) return false;
    return readdirSync(projects).some((project) =>
      existsSync(join(projects, project, `${session.id}.jsonl`)),
    );
  },
  renameInstruction(name) {
    return `Ask the human to run /rename ${name} in Claude Code so the titles match.`;
  },
  renderRunDirectory: renderClaudeRunDirectory,
};

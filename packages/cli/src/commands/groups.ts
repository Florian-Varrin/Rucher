import {
  archiveGroupSessions,
  CarnetError,
  createGroup,
  deleteGroupNotes,
  dropGroup,
  groupSessionCounts,
  listGroups,
  loadGroup,
  openGroupCarnet,
  renameGroup,
  renameGroupRows,
  renderWorkspace,
  type Session,
} from '@rucher/carnet';
import { resolve } from 'node:path';
import { paint } from '../color.ts';
import type { Io } from '../io.ts';
import { CliError } from '../session.ts';
import { processIsAlive } from './sessions.ts';

type IsAlive = (processId: number) => boolean;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function groupsList(io: Io): number {
  const colors = paint(io);
  const groups = listGroups(io.env);
  if (groups.length === 0) {
    io.stdout(`${colors.dim('no group yet, create one with `rucher groups create <name>`')}\n`);
    return 0;
  }
  const carnet = openGroupCarnet(null, { env: io.env });
  const sessions = groupSessionCounts(carnet.db);
  carnet.close();
  const width = Math.max(...groups.map((group) => group.name.length));
  const lines = groups.map(
    (group) =>
      `${colors.bold(group.name.padEnd(width))}  ${plural(group.repos.length, 'repo')}  ${plural(sessions.get(group.name) ?? 0, 'session')}  ${colors.dim(group.workspace)}`,
  );
  io.stdout(`${lines.join('\n')}\n`);
  return 0;
}

export interface GroupsCreateOptions {
  repos?: string[] | undefined;
}

export function groupsCreate(name: string, io: Io, options: GroupsCreateOptions = {}): number {
  const colors = paint(io);
  const group = createGroup(name, {
    repos: options.repos?.map((repo) => resolve(io.cwd, repo)),
    env: io.env,
  });
  const result = renderWorkspace(group, { env: io.env });
  const lines = [
    `${colors.bold(group.name)} created`,
    `  source: ${group.source}`,
    `  workspace: ${group.workspace}`,
    `  repos: ${group.repos.length ? group.repos.map((repo) => repo.path).join(', ') : 'none yet, add them with `rucher group add <path> -g ' + group.name + '`'}`,
    ...result.written.map((path) => `  written ${path}`),
    '',
    'Accept the Claude Code trust prompt in its first session: until then the workspace settings are ignored, and rucher passes the repos with --add-dir.',
    `Next: \`rucher group edit -g ${group.name}\` for its instructions, then \`rucher new <session> -g ${group.name}\`.`,
  ];
  io.stdout(`${lines.join('\n')}\n`);
  return 0;
}

function liveSessions(carnet: ReturnType<typeof openGroupCarnet>, isAlive: IsAlive): Session[] {
  return carnet.sessions
    .list({ includeTemp: true })
    .filter(
      (session) =>
        session.status === 'running' && session.hostPid !== null && isAlive(session.hostPid),
    );
}

function refuseLive(carnet: ReturnType<typeof openGroupCarnet>, action: string, isAlive: IsAlive) {
  const live = liveSessions(carnet, isAlive);
  if (live.length) {
    throw new CliError(
      `${plural(live.length, 'session')} of ${carnet.group?.name} still running: ${live.map((session) => session.name ?? session.id.slice(0, 8)).join(', ')}`,
      `end them before you ${action} the group`,
    );
  }
}

export interface GroupsChangeOptions {
  isAlive?: IsAlive | undefined;
}

export function groupsRename(
  from: string,
  to: string,
  io: Io,
  options: GroupsChangeOptions = {},
): number {
  const carnet = openGroupCarnet(loadGroup(from, io.env), { env: io.env });
  try {
    refuseLive(carnet, 'rename', options.isAlive ?? processIsAlive);
    const group = renameGroup(from, to, io.env);
    try {
      renameGroupRows(carnet.db, from, to);
    } catch (error) {
      renameGroup(to, from, io.env);
      throw error;
    }
    io.stdout(`renamed ${from} to ${to}; its workspace stays at ${group.workspace}\n`);
    return 0;
  } finally {
    carnet.close();
  }
}

export interface GroupsDropOptions extends GroupsChangeOptions {
  purge?: boolean | undefined;
  now?: (() => Date) | undefined;
}

export function groupsDrop(name: string, io: Io, options: GroupsDropOptions = {}): number {
  const carnet = openGroupCarnet(loadGroup(name, io.env), { env: io.env });
  try {
    refuseLive(carnet, 'drop', options.isAlive ?? processIsAlive);
    const at = (options.now ?? (() => new Date()))().toISOString();
    const archived = archiveGroupSessions(carnet.db, name, at);
    const deletedNotes = options.purge ? deleteGroupNotes(carnet.db, name) : 0;
    const group = dropGroup(name, { purge: options.purge, env: io.env });
    const lines = [
      `dropped ${name}: source ${group.source} removed`,
      `  sessions archived: ${archived}`,
      options.purge
        ? `  notes deleted: ${deletedNotes}; workspace ${group.workspace} removed`
        : `  notes and workspace kept; recreate the group under the same name to see them again`,
    ];
    io.stdout(`${lines.join('\n')}\n`);
    return 0;
  } finally {
    carnet.close();
  }
}

export function groupsErrors(io: Io, run: () => number): number {
  try {
    return run();
  } catch (error) {
    if (error instanceof CliError) {
      io.stderr(`error: ${error.message}${error.hint ? `\n  ${error.hint}` : ''}\n`);
      return 1;
    }
    if (error instanceof CarnetError) {
      io.stderr(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

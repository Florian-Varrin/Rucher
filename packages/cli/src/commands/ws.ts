import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  addWorkspaceRepo,
  archiveWorkspaceSessions,
  CarnetError,
  createWorkspace,
  definitionInstructions,
  deleteWorkspaceNotes,
  dropWorkspace,
  listWorkspaces,
  loadWorkspace,
  openWorkspaceCarnet,
  removeWorkspaceRepo,
  renderRunDirectory,
  type Session,
  type Workspace,
  WORKSPACE_FILE,
  workspaceSessionCounts,
} from '@rucher/carnet';
import { paint } from '../color.ts';
import type { Io } from '../io.ts';
import { CliError } from '../session.ts';
import { currentWorkspace } from '../workspace-option.ts';
import { processIsAlive } from './sessions.ts';

export interface WorkspaceOptions {
  workspace?: string | undefined;
}

function carnetErrors(io: Io, run: () => number): number {
  try {
    return run();
  } catch (error) {
    if (error instanceof CarnetError) {
      io.stderr(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

function rendered(workspace: Workspace, io: Io): string[] {
  const result = renderRunDirectory(workspace, { env: io.env });
  return [
    ...result.written.map((path) => `written ${path}`),
    ...result.removed.map((path) => `removed ${path}`),
  ];
}

function withChanges(line: string, changes: string[]): string {
  return `${line}${changes.length ? ` (${changes.join(', ')})` : ''}\n`;
}

export function workspaceShow(io: Io, options: WorkspaceOptions = {}): number {
  return carnetErrors(io, () => {
    const colors = paint(io);
    const workspace = currentWorkspace(io, options.workspace);
    const repos = workspace.repos.length
      ? workspace.repos.map((repo) => `  ${repo.name}  ${colors.dim(repo.path)}`).join('\n')
      : `  ${colors.dim('none')}`;
    io.stdout(
      `${colors.bold(workspace.name)}\ndefinition: ${workspace.definition}\nrun directory: ${workspace.runDirectory}\nrepos:\n${repos}\n`,
    );
    return 0;
  });
}

export function workspaceAdd(repo: string, io: Io, options: WorkspaceOptions = {}): number {
  return carnetErrors(io, () => {
    const found = currentWorkspace(io, options.workspace);
    const path = resolve(io.cwd, repo);
    const workspace = addWorkspaceRepo(found.name, path, io.env);
    io.stdout(withChanges(`added ${basename(path)} to ${workspace.name}`, rendered(workspace, io)));
    return 0;
  });
}

export function workspaceRemove(repo: string, io: Io, options: WorkspaceOptions = {}): number {
  return carnetErrors(io, () => {
    const found = currentWorkspace(io, options.workspace);
    const workspace = removeWorkspaceRepo(found.name, resolve(io.cwd, repo), io.env);
    io.stdout(
      withChanges(`removed ${basename(repo)} from ${workspace.name}`, rendered(workspace, io)),
    );
    return 0;
  });
}

export function workspaceSync(io: Io, options: WorkspaceOptions = {}): number {
  return carnetErrors(io, () => {
    const workspace = currentWorkspace(io, options.workspace);
    const changes = rendered(workspace, io);
    io.stdout(
      changes.length
        ? `${[`synced ${workspace.name}`, ...changes.map((change) => `  ${change}`)].join('\n')}\n`
        : `${workspace.name} already in sync\n`,
    );
    return 0;
  });
}

export interface WorkspacePathOptions extends WorkspaceOptions {
  definition?: boolean | undefined;
}

export function workspacePath(io: Io, options: WorkspacePathOptions = {}): number {
  return carnetErrors(io, () => {
    const workspace = currentWorkspace(io, options.workspace);
    io.stdout(`${options.definition ? workspace.definition : workspace.runDirectory}\n`);
    return 0;
  });
}

export interface WorkspaceEditOptions extends WorkspaceOptions {
  json?: boolean | undefined;
  openEditor?: ((file: string) => number) | undefined;
  confirm?: ((question: string) => Promise<boolean>) | undefined;
}

export function editorCommand(env: NodeJS.ProcessEnv): string {
  return env.VISUAL || env.EDITOR || 'vi';
}

function openEditorFor(io: Io): (file: string) => number {
  return (file) => {
    const result = spawnSync(`${editorCommand(io.env)} "$RUCHER_EDIT_FILE"`, {
      shell: true,
      stdio: 'inherit',
      env: { ...io.env, RUCHER_EDIT_FILE: file },
    });
    return result.status ?? 1;
  };
}

function invalidWorkspaceFile(name: string, io: Io): string | null {
  try {
    loadWorkspace(name, io.env);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function workspaceEdit(io: Io, options: WorkspaceEditOptions = {}): Promise<number> {
  let workspace: Workspace;
  let file: string;
  try {
    workspace = currentWorkspace(io, options.workspace);
    file = join(
      workspace.definition,
      options.json ? WORKSPACE_FILE : definitionInstructions(workspace),
    );
  } catch (error) {
    if (error instanceof CarnetError) {
      io.stderr(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
  const original = readFileSync(file, 'utf8');
  const openEditor = options.openEditor ?? openEditorFor(io);
  for (;;) {
    if (openEditor(file) !== 0) {
      io.stderr(`error: ${editorCommand(io.env)} exited with an error, nothing synced\n`);
      return 1;
    }
    const problem = options.json ? invalidWorkspaceFile(workspace.name, io) : null;
    if (!problem) break;
    io.stderr(`error: ${WORKSPACE_FILE} is invalid: ${problem}\n`);
    if (!options.confirm || !(await options.confirm('Edit it again? [Y/n] '))) {
      writeFileSync(file, original);
      io.stderr(`restored the previous ${WORKSPACE_FILE}\n`);
      return 1;
    }
  }
  return workspaceSync(io, { workspace: workspace.name });
}

type IsAlive = (processId: number) => boolean;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function workspaceList(io: Io): number {
  const colors = paint(io);
  const workspaces = listWorkspaces(io.env);
  if (workspaces.length === 0) {
    io.stdout(`${colors.dim('no workspace yet, create one with `rucher ws create <name>`')}\n`);
    return 0;
  }
  const carnet = openWorkspaceCarnet(null, { env: io.env });
  const sessions = workspaceSessionCounts(carnet.db);
  carnet.close();
  const width = Math.max(...workspaces.map((workspace) => workspace.name.length));
  const lines = workspaces.map(
    (workspace) =>
      `${colors.bold(workspace.name.padEnd(width))}  ${plural(workspace.repos.length, 'repo')}  ${plural(sessions.get(workspace.name) ?? 0, 'session')}  ${colors.dim(workspace.runDirectory)}`,
  );
  io.stdout(`${lines.join('\n')}\n`);
  return 0;
}

export interface WorkspaceCreateOptions {
  repos?: string[] | undefined;
}

export function workspaceCreate(
  name: string,
  io: Io,
  options: WorkspaceCreateOptions = {},
): number {
  const colors = paint(io);
  const workspace = createWorkspace(name, {
    repos: options.repos?.map((repo) => resolve(io.cwd, repo)),
    env: io.env,
  });
  const result = renderRunDirectory(workspace, { env: io.env });
  const lines = [
    `${colors.bold(workspace.name)} created`,
    `  definition: ${workspace.definition}`,
    `  run directory: ${workspace.runDirectory}`,
    `  repos: ${workspace.repos.length ? workspace.repos.map((repo) => repo.path).join(', ') : 'none yet, add them with `rucher ws add <path> --ws ' + workspace.name + '`'}`,
    ...result.written.map((path) => `  written ${path}`),
    '',
    'Accept the Claude Code trust prompt in its first session: until then the run directory settings are ignored, and rucher passes the repos with --add-dir.',
    `Next: \`rucher ws edit --ws ${workspace.name}\` for its instructions, then \`rucher new <session> --ws ${workspace.name}\`.`,
  ];
  io.stdout(`${lines.join('\n')}\n`);
  return 0;
}

function liveSessions(carnet: ReturnType<typeof openWorkspaceCarnet>, isAlive: IsAlive): Session[] {
  return carnet.sessions
    .list({ includeTemp: true })
    .filter(
      (session) =>
        session.status === 'running' && session.hostPid !== null && isAlive(session.hostPid),
    );
}

function refuseLive(
  carnet: ReturnType<typeof openWorkspaceCarnet>,
  action: string,
  isAlive: IsAlive,
) {
  const live = liveSessions(carnet, isAlive);
  if (live.length) {
    throw new CliError(
      `${plural(live.length, 'session')} of ${carnet.workspace?.name} still running: ${live.map((session) => session.name ?? session.id.slice(0, 8)).join(', ')}`,
      `end them before you ${action} the workspace`,
    );
  }
}

export interface WorkspaceDropOptions {
  isAlive?: IsAlive | undefined;
  purge?: boolean | undefined;
  now?: (() => Date) | undefined;
}

export function workspaceDrop(name: string, io: Io, options: WorkspaceDropOptions = {}): number {
  const carnet = openWorkspaceCarnet(loadWorkspace(name, io.env), { env: io.env });
  try {
    refuseLive(carnet, 'drop', options.isAlive ?? processIsAlive);
    const at = (options.now ?? (() => new Date()))().toISOString();
    const archived = archiveWorkspaceSessions(carnet.db, name, at);
    const deletedNotes = options.purge ? deleteWorkspaceNotes(carnet.db, name) : 0;
    const workspace = dropWorkspace(name, { purge: options.purge, env: io.env });
    const lines = [
      `dropped ${name}: definition ${workspace.definition} removed`,
      `  sessions archived: ${archived}`,
      options.purge
        ? `  notes deleted: ${deletedNotes}; run directory ${workspace.runDirectory} removed`
        : `  notes and run directory kept; recreate the workspace under the same name to see them again`,
    ];
    io.stdout(`${lines.join('\n')}\n`);
    return 0;
  } finally {
    carnet.close();
  }
}

export function workspaceErrors(io: Io, run: () => number): number {
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

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  addGroupRepo,
  CarnetError,
  GROUP_FILE,
  type Group,
  INSTRUCTIONS_FILE,
  loadGroup,
  removeGroupRepo,
  renderWorkspace,
} from '@rucher/carnet';
import { paint } from '../color.ts';
import { currentGroup } from '../group-option.ts';
import type { Io } from '../io.ts';

export interface GroupOptions {
  group?: string | undefined;
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

function rendered(group: Group, io: Io): string[] {
  const result = renderWorkspace(group, { env: io.env });
  return [
    ...result.written.map((path) => `written ${path}`),
    ...result.removed.map((path) => `removed ${path}`),
  ];
}

function withChanges(line: string, changes: string[]): string {
  return `${line}${changes.length ? ` (${changes.join(', ')})` : ''}\n`;
}

export function groupShow(io: Io, options: GroupOptions = {}): number {
  return carnetErrors(io, () => {
    const colors = paint(io);
    const group = currentGroup(io, options.group);
    const repos = group.repos.length
      ? group.repos.map((repo) => `  ${repo.name}  ${colors.dim(repo.path)}`).join('\n')
      : `  ${colors.dim('none')}`;
    io.stdout(
      `${colors.bold(group.name)}\nsource: ${group.source}\nworkspace: ${group.workspace}\nrepos:\n${repos}\n`,
    );
    return 0;
  });
}

export function groupAdd(repo: string, io: Io, options: GroupOptions = {}): number {
  return carnetErrors(io, () => {
    const found = currentGroup(io, options.group);
    const path = resolve(io.cwd, repo);
    const group = addGroupRepo(found.name, path, io.env);
    io.stdout(withChanges(`added ${basename(path)} to ${group.name}`, rendered(group, io)));
    return 0;
  });
}

export function groupRemove(repo: string, io: Io, options: GroupOptions = {}): number {
  return carnetErrors(io, () => {
    const found = currentGroup(io, options.group);
    const group = removeGroupRepo(found.name, resolve(io.cwd, repo), io.env);
    io.stdout(withChanges(`removed ${basename(repo)} from ${group.name}`, rendered(group, io)));
    return 0;
  });
}

export function groupSync(io: Io, options: GroupOptions = {}): number {
  return carnetErrors(io, () => {
    const group = currentGroup(io, options.group);
    const changes = rendered(group, io);
    io.stdout(
      changes.length
        ? `${[`synced ${group.name}`, ...changes.map((change) => `  ${change}`)].join('\n')}\n`
        : `${group.name} already in sync\n`,
    );
    return 0;
  });
}

export interface GroupPathOptions extends GroupOptions {
  source?: boolean | undefined;
}

export function groupPath(io: Io, options: GroupPathOptions = {}): number {
  return carnetErrors(io, () => {
    const group = currentGroup(io, options.group);
    io.stdout(`${options.source ? group.source : group.workspace}\n`);
    return 0;
  });
}

export interface GroupEditOptions extends GroupOptions {
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

function invalidGroupFile(name: string, io: Io): string | null {
  try {
    loadGroup(name, io.env);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function groupEdit(io: Io, options: GroupEditOptions = {}): Promise<number> {
  let group: Group;
  try {
    group = currentGroup(io, options.group);
  } catch (error) {
    if (error instanceof CarnetError) {
      io.stderr(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
  const file = join(group.source, options.json ? GROUP_FILE : INSTRUCTIONS_FILE);
  const original = readFileSync(file, 'utf8');
  const openEditor = options.openEditor ?? openEditorFor(io);
  for (;;) {
    if (openEditor(file) !== 0) {
      io.stderr(`error: ${editorCommand(io.env)} exited with an error, nothing synced\n`);
      return 1;
    }
    const problem = options.json ? invalidGroupFile(group.name, io) : null;
    if (!problem) break;
    io.stderr(`error: ${GROUP_FILE} is invalid: ${problem}\n`);
    if (!options.confirm || !(await options.confirm('Edit it again? [Y/n] '))) {
      writeFileSync(file, original);
      io.stderr(`restored the previous ${GROUP_FILE}\n`);
      return 1;
    }
  }
  return groupSync(io, { group: group.name });
}

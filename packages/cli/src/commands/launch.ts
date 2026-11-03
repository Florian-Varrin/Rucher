import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  appendPromptFile,
  type Carnet,
  hostById,
  repoNameFor,
  type Session,
  type SessionKind,
} from '@rucher/carnet';
import type { Io } from '../io.ts';
import { CliError, findSession } from '../session.ts';

export interface LaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  sessionId?: string;
  parentId?: string;
  knownChildren?: string[];
}

export interface SplitArguments {
  own: string[];
  passthrough: string[];
}

export function splitPassthrough(rawArgs: readonly string[]): SplitArguments {
  const separator = rawArgs.indexOf('--');
  if (separator === -1) return { own: [...rawArgs], passthrough: [] };
  return { own: rawArgs.slice(0, separator), passthrough: rawArgs.slice(separator + 1) };
}

export function positionals(own: readonly string[]): string[] {
  return own.filter((argument) => !argument.startsWith('-'));
}

function launchEnv(
  carnet: Carnet,
  session: Pick<Session, 'id' | 'name'>,
  promptVersion: string,
  kind?: SessionKind,
) {
  return {
    RUCHER_SESSION_ID: session.id,
    RUCHER_PROMPT_VERSION: promptVersion,
    RUCHER_SESSION_NAME: session.name ?? '',
    RUCHER_GROUP: carnet.group.name,
    RUCHER_GROUP_ROOT: carnet.group.root,
    ...(kind ? { RUCHER_SESSION_KIND: kind } : {}),
  };
}

export interface NewSessionOptions {
  kind: SessionKind;
  name?: string | undefined;
  passthrough?: readonly string[];
}

export function planNew(carnet: Carnet, io: Io, options: NewSessionOptions): LaunchPlan {
  if (options.kind === 'active' && !options.name) {
    throw new CliError('An active session needs a name', 'rucher new <name>');
  }
  const session = carnet.sessions.create({
    id: randomUUID(),
    kind: options.kind,
    name: options.name,
    cwd: carnet.group.root,
    repo: repoNameFor(carnet.group, io.cwd),
  });
  const host = hostById(session.host);
  const prompt = appendPromptFile(carnet.group, session, io.env);
  const command = host.launchCommand(session.id, {
    name: session.name,
    appendPromptFile: prompt.path,
    passthrough: options.passthrough,
  });
  return {
    ...command,
    cwd: carnet.group.root,
    env: launchEnv(carnet, session, prompt.version),
    sessionId: session.id,
  };
}

// Hosts store conversations per project directory, so a session reopens from its original cwd.
function sessionDirectory(session: Session, io: Io): string {
  return session.cwd && existsSync(session.cwd) ? session.cwd : io.cwd;
}

export function planResume(
  carnet: Carnet,
  io: Io,
  reference: string,
  passthrough: readonly string[] = [],
): LaunchPlan {
  const session = findSession(carnet, reference);
  if (session.status === 'archived') io.stderr(`warning: session ${reference} is archived\n`);
  const prompt = appendPromptFile(carnet.group, session, io.env);
  const command = hostById(session.host).resumeCommand(session, {
    appendPromptFile: prompt.path,
    passthrough,
  });
  return {
    ...command,
    cwd: sessionDirectory(session, io),
    env: launchEnv(carnet, session, prompt.version),
    sessionId: session.id,
  };
}

export interface ForkOptions {
  name?: string | undefined;
  active?: boolean | undefined;
  passthrough?: readonly string[];
}

export function planFork(
  carnet: Carnet,
  io: Io,
  reference: string,
  options: ForkOptions = {},
): LaunchPlan {
  if (options.active && !options.name) {
    throw new CliError('An active fork needs a name', 'rucher fork <session> <name> --active');
  }
  if (options.name && carnet.sessions.byName(options.name)) {
    throw new CliError(`A session named "${options.name}" already exists`);
  }
  const parent = findSession(carnet, reference);
  const kind: SessionKind = options.active ? 'active' : 'temp';
  const command = hostById(parent.host).forkCommand(parent, {
    name: options.name,
    appendPromptFile: appendPromptFile(carnet.group, parent, io.env).path,
    passthrough: options.passthrough,
  });
  return {
    ...command,
    cwd: sessionDirectory(parent, io),
    // A fork keeps its parent's system prompt snapshot, so the parent's rules are the ones in effect.
    env: {
      ...launchEnv(carnet, parent, parent.promptVersion ?? '', kind),
      RUCHER_SESSION_NAME: options.name ?? '',
    },
    parentId: parent.id,
    knownChildren: childrenOf(carnet, parent.id).map((session) => session.id),
  };
}

function childrenOf(carnet: Carnet, parentId: string): Session[] {
  return carnet.sessions
    .list({ includeTemp: true, includeArchived: true })
    .filter((session) => session.parentId === parentId);
}

// The host picks a fork's id, so the launcher finds it as the parent's new child.
function forkChild(carnet: Carnet, plan: LaunchPlan): Session | undefined {
  if (!plan.parentId) return undefined;
  const known = new Set(plan.knownChildren);
  return childrenOf(carnet, plan.parentId).find((session) => !known.has(session.id));
}

export function finishLaunch(carnet: Carnet, plan: LaunchPlan): void {
  const id = plan.sessionId ?? forkChild(carnet, plan)?.id;
  if (id && carnet.sessions.get(id)) carnet.sessions.end(id);
}

export function startLaunch(carnet: Carnet, plan: LaunchPlan): void {
  if (plan.sessionId) carnet.sessions.setStatus(plan.sessionId, 'running');
}

export function spawnLaunch(plan: LaunchPlan, env: NodeJS.ProcessEnv): number {
  const result = spawnSync(plan.command, plan.args, {
    cwd: plan.cwd,
    stdio: 'inherit',
    env: { ...env, ...plan.env },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

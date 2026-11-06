import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  dropAgent,
  finishAgent,
  type FinishAgentInput,
  getAgent,
  listAgents,
  type ListAgentsOptions,
  reorderQueue,
  startAgent,
  type StartAgentInput,
  updateAgent,
  type UpdateAgentInput,
} from './agents.ts';
import type { Ctx } from './context.ts';
import { MEMORY_DB, openDatabase } from './db/open.ts';
import { databasePath } from './paths.ts';
import { logEvent, type LogEventInput, readEvents } from './events.ts';
import {
  type Workspace,
  type WorkspaceResolution,
  requireWorkspace,
  resolveWorkspace,
} from './workspace/locate.ts';
import {
  copyInjectedRepos,
  type MemoryOptions,
  repoMemory,
  sessionMemory,
  sessionStartMemory,
} from './memory.ts';
import { mergeSessions } from './merge.ts';
import {
  type AddNoteInput,
  addNote,
  type CiteNoteInput,
  citeNote,
  type DropNoteInput,
  dropNote,
  getNote,
  listNotes,
  type ListNotesOptions,
  noteDetail,
  recordActiveDay,
  staleNotes,
  sessionNoteActivity,
} from './notes.ts';
import { purgeSessions } from './purge.ts';
import {
  createSession,
  type CreateSessionInput,
  defaultSession,
  dropSession,
  endSession,
  ensureSession,
  getSession,
  type HookEnv,
  type HookSessionPayload,
  listSessions,
  type ListSessionsOptions,
  nameSession,
  adoptTitle,
  requireSession,
  findSession,
  recordPromptVersion,
  type Session,
  type SessionKind,
  type SessionStatus,
  setParent,
  setSessionKind,
  setSessionStatus,
  demoteSession,
  promoteSession,
  renameSession,
  resetDeadSessions,
  staleTempSessions,
  sessionByHostProcess,
  sessionByName,
  touchSession,
  upsertFromHook,
} from './sessions.ts';
import { type RenderOptions, renderSections, renderStatus } from './status/render.ts';
import { buildStatusView } from './status/view.ts';
import { pairSubagent, stopSubagent } from './subagents.ts';
import { clearTable, getTable, setTable, type SetTableInput } from './table.ts';

export interface CarnetOptions {
  now?: () => Date;
}

export class Carnet {
  readonly db: DatabaseSync;
  private readonly ctx: Ctx;

  constructor(
    db: DatabaseSync,
    readonly workspace: Workspace | null,
    options: CarnetOptions = {},
  ) {
    this.db = db;
    this.ctx = { db, now: options.now ?? (() => new Date()), workspace: workspace?.name ?? null };
  }

  requireWorkspace(): Workspace {
    return requireWorkspace(this.workspace);
  }

  readonly sessions = {
    get: (id: string) => getSession(this.ctx, id),
    find: (reference: string) => findSession(this.ctx, reference),
    require: (id: string) => requireSession(this.ctx, id),
    ensure: (id: string, cwd?: string) =>
      ensureSession(this.ctx, id, cwd, this.workspace ?? undefined),
    upsertFromHook: (payload: HookSessionPayload, env?: HookEnv) =>
      upsertFromHook(this.ctx, this.workspace, payload, env),
    touch: (id: string) => touchSession(this.ctx, id),
    merge: (fromId: string, intoId: string) => mergeSessions(this.ctx, fromId, intoId),
    purge: (keepId: string, days: number) => purgeSessions(this.ctx, keepId, days),
    name: (id: string, name: string, purpose?: string) => nameSession(this.ctx, id, name, purpose),
    adoptTitle: (id: string, title: string | undefined) => adoptTitle(this.ctx, id, title),
    list: (options?: ListSessionsOptions) => listSessions(this.ctx, options),
    drop: (id: string) => dropSession(this.ctx, id),
    default: () => defaultSession(this.ctx),
    byName: (name: string) => sessionByName(this.ctx, name),
    byHostProcess: (host: string, processId: number) =>
      sessionByHostProcess(this.ctx, host, processId),
    recordPromptVersion: (id: string, version: string | null) =>
      recordPromptVersion(this.ctx, id, version),
    setParent: (id: string, parentId: string) => setParent(this.ctx, id, parentId),
    setStatus: (id: string, status: SessionStatus) => setSessionStatus(this.ctx, id, status),
    create: (input: CreateSessionInput) => createSession(this.ctx, input),
    setKind: (id: string, kind: SessionKind, name?: string | null) =>
      setSessionKind(this.ctx, id, kind, name),
    end: (id: string) => endSession(this.ctx, id),
    rename: (id: string, name: string) => renameSession(this.ctx, id, name),
    promote: (id: string, name?: string) => promoteSession(this.ctx, id, name),
    demote: (id: string) => demoteSession(this.ctx, id),
    staleTemp: (olderThanMilliseconds: number) =>
      staleTempSessions(this.ctx, olderThanMilliseconds),
    resetDead: (isAlive: (processId: number) => boolean) => resetDeadSessions(this.ctx, isAlive),
  };

  readonly agents = {
    get: (session: string, name: string) => getAgent(this.ctx, session, name),
    start: (session: string, input: StartAgentInput) => startAgent(this.ctx, session, input),
    update: (session: string, name: string, input: UpdateAgentInput) =>
      updateAgent(this.ctx, session, name, input),
    finish: (session: string, name: string, input: FinishAgentInput) =>
      finishAgent(this.ctx, session, name, input),
    drop: (session: string, name: string, reason?: string) =>
      dropAgent(this.ctx, session, name, reason),
    list: (session: string, options?: ListAgentsOptions) => listAgents(this.ctx, session, options),
    reorderQueue: (session: string, names: string[]) => reorderQueue(this.ctx, session, names),
    pairSubagent: (session: string, hostAgentId: string) =>
      pairSubagent(this.ctx, session, hostAgentId),
    stopSubagent: (session: string, hostAgentId: string, names?: string[]) =>
      stopSubagent(this.ctx, session, hostAgentId, names),
  };

  readonly table = {
    get: (session: string) => getTable(this.ctx, session),
    set: (session: string, input: SetTableInput) => setTable(this.ctx, session, input),
    clear: (session: string) => clearTable(this.ctx, session),
  };

  readonly events = {
    log: (session: string, input: LogEventInput) => logEvent(this.ctx, session, input),
    read: (session: string, limit?: number, agentOnly?: boolean) =>
      readEvents(this.ctx, { session, limit, agentOnly }),
  };

  readonly notes = {
    add: (input: AddNoteInput) => addNote(this.ctx, this.workspace, input),
    get: (id: number) => getNote(this.ctx, id),
    show: (id: number, halfLifeDays?: number) => noteDetail(this.ctx, id, halfLifeDays),
    list: (options?: ListNotesOptions) => listNotes(this.ctx, options),
    stale: (halfLifeDays?: number) => staleNotes(this.ctx, halfLifeDays),
    drop: (id: number, input: DropNoteInput) => dropNote(this.ctx, id, input),
    cite: (id: number, input: CiteNoteInput) => citeNote(this.ctx, id, input),
    recordActiveDay: () => recordActiveDay(this.ctx),
    activity: (session: string) => sessionNoteActivity(this.ctx, session),
  };

  readonly memory = {
    atStart: (session: Session, options?: MemoryOptions) =>
      sessionStartMemory(this.ctx, this.workspace, session, options),
    ofSession: (session: Session, options?: MemoryOptions) =>
      sessionMemory(this.ctx, this.workspace, session, options),
    forRepo: (session: Session, repo: string, options?: MemoryOptions) =>
      repoMemory(this.ctx, session, repo, options),
    copyRepos: (from: string, into: string) => copyInjectedRepos(this.ctx, from, into),
  };

  readonly status = {
    view: (session: Session) => buildStatusView(this.ctx, session),
    render: (session: Session, options?: RenderOptions) =>
      renderStatus(buildStatusView(this.ctx, session), options),
    sections: (session: Session) => renderSections(buildStatusView(this.ctx, session)),
  };

  close(): void {
    this.db.close();
  }
}

export interface OpenCarnetOptions extends CarnetOptions {
  workspace?: string | undefined;
  sessionId?: string | undefined;
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  dbPath?: string | undefined;
}

function openStore(options: OpenCarnetOptions): DatabaseSync {
  const path = options.dbPath ?? databasePath(options.env);
  if (path !== MEMORY_DB) mkdirSync(dirname(path), { recursive: true });
  return openDatabase(path);
}

export function openCarnet(options: OpenCarnetOptions = {}): Carnet {
  return openResolvedCarnet(options).carnet;
}

export interface ResolvedCarnet {
  carnet: Carnet;
  resolution: WorkspaceResolution;
}

export function openResolvedCarnet(options: OpenCarnetOptions = {}): ResolvedCarnet {
  const db = openStore(options);
  try {
    const resolution = resolveWorkspace({ ...options, db });
    return { carnet: new Carnet(db, resolution.workspace, options), resolution };
  } catch (error) {
    db.close();
    throw error;
  }
}

export function openWorkspaceCarnet(
  workspace: Workspace | null,
  options: OpenCarnetOptions = {},
): Carnet {
  return new Carnet(openStore(options), workspace, options);
}

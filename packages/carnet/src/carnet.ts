import type { DatabaseSync } from "node:sqlite";
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
} from "./agents.ts";
import type { Ctx } from "./context.ts";
import { openDatabase } from "./db/open.ts";
import { logEvent, type LogEventInput, readEvents } from "./events.ts";
import { type Group, type LocateOptions, locateGroup } from "./group/locate.ts";
import {
  defaultSession,
  dropSession,
  ensureSession,
  getSession,
  type HookEnv,
  type HookSessionPayload,
  listSessions,
  type ListSessionsOptions,
  nameSession,
  requireSession,
  type Session,
  sessionByClaudePid,
  sessionByName,
  touchSession,
  upsertFromHook,
} from "./sessions.ts";
import { renderSections, renderStatus } from "./status/render.ts";
import { buildStatusView } from "./status/view.ts";
import { pairSubagent, stopSubagent } from "./subagents.ts";
import { clearTable, getTable, setTable, type SetTableInput } from "./table.ts";

export interface CarnetOptions {
  now?: () => Date;
}

export class Carnet {
  readonly db: DatabaseSync;
  private readonly ctx: Ctx;

  constructor(
    readonly group: Group,
    db: DatabaseSync,
    options: CarnetOptions = {},
  ) {
    this.db = db;
    this.ctx = { db, now: options.now ?? (() => new Date()) };
  }

  readonly sessions = {
    get: (id: string) => getSession(this.ctx, id),
    require: (id: string) => requireSession(this.ctx, id),
    ensure: (id: string, cwd?: string) => ensureSession(this.ctx, id, cwd, this.group),
    upsertFromHook: (payload: HookSessionPayload, env?: HookEnv) =>
      upsertFromHook(this.ctx, this.group, payload, env),
    touch: (id: string) => touchSession(this.ctx, id),
    name: (id: string, name: string, purpose?: string) => nameSession(this.ctx, id, name, purpose),
    list: (options?: ListSessionsOptions) => listSessions(this.ctx, options),
    drop: (id: string) => dropSession(this.ctx, id),
    default: () => defaultSession(this.ctx),
    byName: (name: string) => sessionByName(this.ctx, name),
    byClaudePid: (pid: number) => sessionByClaudePid(this.ctx, pid),
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
    pairSubagent: (session: string, claudeAgentId: string) =>
      pairSubagent(this.ctx, session, claudeAgentId),
    stopSubagent: (session: string, claudeAgentId: string) =>
      stopSubagent(this.ctx, session, claudeAgentId),
  };

  readonly table = {
    get: (session: string) => getTable(this.ctx, session),
    set: (session: string, input: SetTableInput) => setTable(this.ctx, session, input),
    clear: (session: string) => clearTable(this.ctx, session),
  };

  readonly events = {
    log: (session: string, input: LogEventInput) => logEvent(this.ctx, session, input),
    read: (session: string, limit?: number) => readEvents(this.ctx, { session, limit }),
  };

  readonly status = {
    view: (session: Session) => buildStatusView(this.ctx, session),
    render: (session: Session) => renderStatus(buildStatusView(this.ctx, session)),
    sections: (session: Session) => renderSections(buildStatusView(this.ctx, session)),
  };

  close(): void {
    this.db.close();
  }
}

export interface OpenCarnetOptions extends LocateOptions, CarnetOptions {
  dbPath?: string;
}

export function openCarnet(options: OpenCarnetOptions = {}): Carnet {
  const group = locateGroup(options);
  return new Carnet(group, openDatabase(options.dbPath ?? group.dbPath), options);
}

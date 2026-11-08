import type { Carnet } from './carnet.ts';
import { CarnetError } from './errors.ts';
import type { Session } from './sessions.ts';

export interface MoveOptions {
  merge?: boolean | undefined;
  dryRun?: boolean | undefined;
}

export interface MoveResult {
  session: Session;
  into: Session | null;
  movedAgents: string[];
  skippedAgents: string[];
  movedEvents: number;
  movedTable: boolean;
  keptNotes: number;
}

function count(carnet: Carnet, sql: string, ...parameters: string[]): number {
  return Number((carnet.db.prepare(sql).get(...parameters) as { total: number }).total);
}

function agentNames(carnet: Carnet, session: string): string[] {
  return (
    carnet.db
      .prepare('SELECT name FROM agents WHERE session = ? ORDER BY started_at, rowid')
      .all(session) as unknown as { name: string }[]
  ).map((row) => row.name);
}

function sessionNamed(carnet: Carnet, workspace: string, name: string): Session | null {
  const row = carnet.db
    .prepare('SELECT id FROM sessions WHERE workspace = ? AND name = ?')
    .get(workspace, name) as { id: string } | undefined;
  return row ? carnet.sessions.require(row.id) : null;
}

// One database holds every workspace: moving a session only changes its workspace, and its agents,
// events and table line follow its id. Notes stay in the workspace they were written in.
export function moveSession(
  carnet: Carnet,
  sessionId: string,
  targetWorkspace: string,
  options: MoveOptions = {},
): MoveResult {
  const session = carnet.sessions.require(sessionId);
  if (session.workspace !== (carnet.workspace?.name ?? null)) {
    throw new CarnetError('SESSION_NOT_FOUND', `Unknown session ${sessionId}`);
  }
  if (session.workspace === targetWorkspace) {
    throw new CarnetError('SESSION_MOVE_INVALID', 'The session is already in this workspace');
  }
  const into = session.name ? sessionNamed(carnet, targetWorkspace, session.name) : null;
  if (into && !options.merge) {
    throw new CarnetError(
      'SESSION_NAME_TAKEN',
      `Workspace ${targetWorkspace} already has session ${into.name}: pass --merge to merge into it`,
    );
  }
  const agents = agentNames(carnet, session.id);
  const taken = new Set(into ? agentNames(carnet, into.id) : []);
  const hasTable = (id: string) =>
    carnet.db.prepare('SELECT 1 FROM table_items WHERE session = ?').get(id) !== undefined;
  const result: MoveResult = {
    session,
    into,
    movedAgents: agents.filter((name) => !taken.has(name)),
    skippedAgents: agents.filter((name) => taken.has(name)),
    movedEvents: count(
      carnet,
      'SELECT COUNT(*) AS total FROM events WHERE session = ?',
      session.id,
    ),
    movedTable: hasTable(session.id) && !(into && hasTable(into.id)),
    keptNotes: count(
      carnet,
      'SELECT COUNT(*) AS total FROM notes WHERE session = ? OR dropped_session = ?',
      session.id,
      session.id,
    ),
  };
  if (options.dryRun) return result;
  if (into) carnet.sessions.merge(session.id, into.id);
  carnet.db
    .prepare('UPDATE sessions SET workspace = ? WHERE id = ?')
    .run(targetWorkspace, session.id);
  return result;
}

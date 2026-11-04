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

function sessionNamed(carnet: Carnet, group: string, name: string): Session | null {
  const row = carnet.db
    .prepare('SELECT id FROM sessions WHERE group_name = ? AND name = ?')
    .get(group, name) as { id: string } | undefined;
  return row ? carnet.sessions.require(row.id) : null;
}

// One database holds every group: moving a session only changes its group, and its agents,
// events and table line follow its id. Notes stay in the group they were written in.
export function moveSession(
  carnet: Carnet,
  sessionId: string,
  targetGroup: string,
  options: MoveOptions = {},
): MoveResult {
  const session = carnet.sessions.require(sessionId);
  if (session.groupName !== (carnet.group?.name ?? null)) {
    throw new CarnetError('SESSION_NOT_FOUND', `Unknown session ${sessionId}`);
  }
  if (session.groupName === targetGroup) {
    throw new CarnetError('SESSION_MOVE_INVALID', 'The session is already in this group');
  }
  const into = session.name ? sessionNamed(carnet, targetGroup, session.name) : null;
  if (into && !options.merge) {
    throw new CarnetError(
      'SESSION_NAME_TAKEN',
      `Group ${targetGroup} already has session ${into.name}: pass --merge to merge into it`,
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
  carnet.db.prepare('UPDATE sessions SET group_name = ? WHERE id = ?').run(targetGroup, session.id);
  return result;
}

import { type Ctx, nowIso } from './context.ts';
import { CarnetError } from './errors.ts';
import type { Workspace } from './workspace/locate.ts';

export const NOTE_KINDS = ['dead_end', 'decision', 'learning'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const NOTE_TEXT_LIMIT = 200;
export const DUPLICATE_SIMILARITY = 0.6;
export const DEFAULT_HALF_LIFE_DAYS = 20;
export const STALE_AFTER_ACTIVE_DAYS = 40;
export const STALE_WEIGHT = 0.05;
const SIMILAR_SHOWN = 3;

export function isNoteKind(value: string): value is NoteKind {
  return (NOTE_KINDS as readonly string[]).includes(value);
}

export function memoryHalfLife(value: string | undefined): number {
  const days = Number(value);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_HALF_LIFE_DAYS;
}

export interface Note {
  id: number;
  kind: NoteKind;
  text: string;
  repos: string[];
  session: string | null;
  agent: string | null;
  similarNotes: number[];
  createdAt: string;
  droppedAt: string | null;
  droppedReason: string | null;
  droppedSession: string | null;
  replacedBy: number | null;
}

export interface NoteCitation {
  id: number;
  note: number;
  session: string | null;
  agent: string | null;
  why: string;
  at: string;
}

export interface WeightedNote extends Note {
  weight: number;
  citationCount: number;
}

export interface NoteDetail extends WeightedNote {
  citations: NoteCitation[];
}

export interface AddNoteInput {
  kind: string;
  text: string;
  repos?: string[] | undefined;
  session?: string | null | undefined;
  agent?: string | null | undefined;
}

export interface AddNoteResult {
  note: Note;
  similar: Note[];
}

export interface ListNotesOptions {
  kind?: string | undefined;
  repo?: string | undefined;
  general?: boolean | undefined;
  query?: string | undefined;
  includeDropped?: boolean | undefined;
  halfLifeDays?: number | undefined;
}

export interface DropNoteInput {
  reason: string;
  replacedBy?: number | undefined;
  session?: string | null | undefined;
}

export interface CiteNoteInput {
  why: string;
  session?: string | null | undefined;
  agent?: string | null | undefined;
}

interface NoteRow {
  id: number;
  number: number;
  kind: NoteKind;
  text: string;
  session: string | null;
  agent: string | null;
  similar_notes: string | null;
  created_at: string;
  dropped_at: string | null;
  dropped_reason: string | null;
  dropped_session: string | null;
  replaced_number: number | null;
}

// Notes are shown and referenced by their number in the workspace; the id stays internal.
const NOTE_COLUMNS = `notes.id, notes.number, notes.kind, notes.text, notes.session, notes.agent,
  notes.similar_notes, notes.created_at, notes.dropped_at, notes.dropped_reason,
  notes.dropped_session,
  (SELECT replaced.number FROM notes AS replaced WHERE replaced.id = notes.replaced_by)
    AS replaced_number`;

const MARKDOWN = /\*\*|__|\[[^\]]*\]\([^)]*\)|^#{1,6}\s|^[-*+]\s/;

function cleanText(value: string, label: string): string {
  const text = value.trim().replace(/[ \t]+/g, ' ');
  if (!text) throw new CarnetError('INVALID_NOTE', `${label} is empty`);
  if (text.length >= NOTE_TEXT_LIMIT) {
    throw new CarnetError(
      'INVALID_NOTE',
      `${label} must stay under ${NOTE_TEXT_LIMIT} characters (${text.length})`,
    );
  }
  if (/[\r\n]/.test(text)) throw new CarnetError('INVALID_NOTE', `${label} must be one line`);
  if (text.includes('`')) throw new CarnetError('INVALID_NOTE', `${label} must not use backticks`);
  if (MARKDOWN.test(text)) throw new CarnetError('INVALID_NOTE', `${label} must not use markdown`);
  return text;
}

export function workspaceRepoNames(workspace: Workspace): string[] {
  return workspace.repos.map((repo) => repo.name);
}

function cleanRepos(workspace: Workspace, repos: string[] | undefined): string[] {
  const known = workspaceRepoNames(workspace);
  const unique = [...new Set((repos ?? []).map((repo) => repo.trim()).filter(Boolean))];
  const unknown = unique.filter((repo) => !known.includes(repo));
  if (unknown.length) {
    throw new CarnetError(
      'INVALID_NOTE',
      `Unknown repo ${unknown.join(', ')} (workspace repos: ${known.join(', ') || 'none'})`,
    );
  }
  return unique;
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

export function similarity(first: string, second: string): number {
  const left = words(first);
  const right = words(second);
  if (left.size === 0 && right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared);
}

export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function recordActiveDay(ctx: Ctx): void {
  if (ctx.workspace === null) return;
  ctx.db
    .prepare('INSERT OR IGNORE INTO active_days (workspace, day) VALUES (?, ?)')
    .run(ctx.workspace, localDay(ctx.now()));
}

function activeDays(ctx: Ctx): string[] {
  const rows = ctx.db
    .prepare('SELECT day FROM active_days WHERE workspace IS ? ORDER BY day')
    .all(ctx.workspace) as unknown as { day: string }[];
  return rows.map((row) => row.day);
}

function activeDaysSince(days: string[], at: string): number {
  const since = localDay(new Date(at));
  return days.filter((day) => day > since).length;
}

function reposOf(ctx: Ctx, noteId: number): string[] {
  const rows = ctx.db
    .prepare('SELECT repo FROM note_repos WHERE note = ? ORDER BY repo')
    .all(noteId) as unknown as { repo: string }[];
  return rows.map((row) => row.repo);
}

function toNote(ctx: Ctx, row: NoteRow): Note {
  return {
    id: row.number,
    kind: row.kind,
    text: row.text,
    repos: reposOf(ctx, row.id),
    session: row.session,
    agent: row.agent,
    similarNotes: row.similar_notes ? (JSON.parse(row.similar_notes) as number[]) : [],
    createdAt: row.created_at,
    droppedAt: row.dropped_at,
    droppedReason: row.dropped_reason,
    droppedSession: row.dropped_session,
    replacedBy: row.replaced_number,
  };
}

function noteRow(ctx: Ctx, number: number): NoteRow | undefined {
  return ctx.db
    .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE workspace IS ? AND number = ?`)
    .get(ctx.workspace, number) as NoteRow | undefined;
}

function noteId(ctx: Ctx, number: number): number {
  const row = noteRow(ctx, number);
  if (!row) throw new CarnetError('NOTE_NOT_FOUND', `Unknown note #${number}`);
  return row.id;
}

export function getNote(ctx: Ctx, id: number): Note | null {
  const row = noteRow(ctx, id);
  return row ? toNote(ctx, row) : null;
}

export function requireNote(ctx: Ctx, id: number): Note {
  const note = getNote(ctx, id);
  if (!note) throw new CarnetError('NOTE_NOT_FOUND', `Unknown note #${id}`);
  return note;
}

function requireActiveNote(ctx: Ctx, id: number): Note {
  const note = requireNote(ctx, id);
  if (note.droppedAt) throw new CarnetError('INVALID_NOTE', `Note #${id} is dropped`);
  return note;
}

const CITATION_COLUMNS = `note_citations.id, notes.number AS note, note_citations.session,
  note_citations.agent, note_citations.why, note_citations.at`;

function citationsOf(ctx: Ctx, number: number): NoteCitation[] {
  return ctx.db
    .prepare(
      `SELECT ${CITATION_COLUMNS} FROM note_citations JOIN notes ON notes.id = note_citations.note
       WHERE notes.workspace IS ? AND notes.number = ? ORDER BY note_citations.at`,
    )
    .all(ctx.workspace, number) as unknown as NoteCitation[];
}

// Several citations in one session count once: the latest stands for that session.
function weightOf(citations: NoteCitation[], days: string[], halfLifeDays: number): number {
  const latest = new Map<string, string>();
  for (const citation of citations) {
    const key = citation.session ?? `citation-${citation.id}`;
    const previous = latest.get(key);
    if (!previous || citation.at > previous) latest.set(key, citation.at);
  }
  let weight = 0;
  for (const at of latest.values()) weight += 0.5 ** (activeDaysSince(days, at) / halfLifeDays);
  return weight;
}

function weigh(ctx: Ctx, note: Note, days: string[], halfLifeDays: number): WeightedNote {
  const citations = citationsOf(ctx, note.id);
  return {
    ...note,
    weight: weightOf(citations, days, halfLifeDays),
    citationCount: citations.length,
  };
}

export function compareNotes(first: WeightedNote, second: WeightedNote): number {
  const kind = NOTE_KINDS.indexOf(first.kind) - NOTE_KINDS.indexOf(second.kind);
  if (kind !== 0) return kind;
  if (first.weight !== second.weight) return second.weight - first.weight;
  return second.id - first.id;
}

function activeNotesOfKind(ctx: Ctx, kind: NoteKind): Note[] {
  const rows = ctx.db
    .prepare(
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE workspace IS ? AND kind = ? AND dropped_at IS NULL`,
    )
    .all(ctx.workspace, kind) as unknown as NoteRow[];
  return rows.map((row) => toNote(ctx, row));
}

export function addNote(ctx: Ctx, workspace: Workspace | null, input: AddNoteInput): AddNoteResult {
  if (workspace === null || ctx.workspace === null) {
    throw new CarnetError('NO_WORKSPACE', 'Notes belong to a workspace: this session has none');
  }
  if (!isNoteKind(input.kind)) {
    throw new CarnetError(
      'INVALID_NOTE',
      `Invalid note kind "${input.kind}" (use ${NOTE_KINDS.join(', ')})`,
    );
  }
  const kind = input.kind;
  const text = cleanText(input.text, 'Note text');
  const repos = cleanRepos(workspace, input.repos);
  const similar = activeNotesOfKind(ctx, kind)
    .map((note) => ({ note, score: similarity(text, note.text) }))
    .filter((candidate) => candidate.score >= DUPLICATE_SIMILARITY)
    .sort((first, second) => second.score - first.score)
    .slice(0, SIMILAR_SHOWN)
    .map((candidate) => candidate.note);
  ctx.db.exec('BEGIN');
  try {
    const next = ctx.db
      .prepare('SELECT COALESCE(MAX(number), 0) + 1 AS number FROM notes WHERE workspace = ?')
      .get(ctx.workspace) as { number: number };
    const result = ctx.db
      .prepare(
        `INSERT INTO notes (workspace, number, kind, text, session, agent, similar_notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ctx.workspace,
        next.number,
        kind,
        text,
        input.session ?? null,
        input.agent ?? null,
        similar.length ? JSON.stringify(similar.map((note) => note.id)) : null,
        nowIso(ctx),
      );
    const id = Number(result.lastInsertRowid);
    const addRepo = ctx.db.prepare('INSERT INTO note_repos (note, repo) VALUES (?, ?)');
    for (const repo of repos) addRepo.run(id, repo);
    ctx.db.exec('COMMIT');
    return { note: requireNote(ctx, next.number), similar };
  } catch (error) {
    ctx.db.exec('ROLLBACK');
    throw error;
  }
}

export function listNotes(ctx: Ctx, options: ListNotesOptions = {}): WeightedNote[] {
  if (options.kind !== undefined && !isNoteKind(options.kind)) {
    throw new CarnetError('INVALID_NOTE', `Invalid note kind "${options.kind}"`);
  }
  const conditions: string[] = ['workspace IS ?'];
  const parameters: (string | null)[] = [ctx.workspace];
  if (!options.includeDropped) conditions.push('dropped_at IS NULL');
  if (options.kind) {
    conditions.push('kind = ?');
    parameters.push(options.kind);
  }
  if (options.repo) {
    conditions.push('id IN (SELECT note FROM note_repos WHERE repo = ?)');
    parameters.push(options.repo);
  }
  if (options.general) conditions.push('id NOT IN (SELECT note FROM note_repos)');
  if (options.query) {
    conditions.push("LOWER(text) LIKE ? ESCAPE '\\'");
    parameters.push(`%${options.query.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`);
  }
  const rows = ctx.db
    .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE ${conditions.join(' AND ')}`)
    .all(...parameters) as unknown as NoteRow[];
  const days = activeDays(ctx);
  const halfLifeDays = options.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  return rows.map((row) => weigh(ctx, toNote(ctx, row), days, halfLifeDays)).sort(compareNotes);
}

export function noteDetail(
  ctx: Ctx,
  id: number,
  halfLifeDays = DEFAULT_HALF_LIFE_DAYS,
): NoteDetail {
  const note = requireNote(ctx, id);
  const citations = citationsOf(ctx, id);
  return {
    ...note,
    weight: weightOf(citations, activeDays(ctx), halfLifeDays),
    citationCount: citations.length,
    citations,
  };
}

export function staleNotes(ctx: Ctx, halfLifeDays = DEFAULT_HALF_LIFE_DAYS): WeightedNote[] {
  const days = activeDays(ctx);
  return listNotes(ctx, { halfLifeDays }).filter(
    (note) =>
      activeDaysSince(days, note.createdAt) > STALE_AFTER_ACTIVE_DAYS &&
      (note.citationCount === 0 || note.weight < STALE_WEIGHT),
  );
}

export function dropNote(ctx: Ctx, id: number, input: DropNoteInput): Note {
  requireActiveNote(ctx, id);
  const reason = cleanText(input.reason, 'Drop reason');
  if (input.replacedBy !== undefined) {
    if (input.replacedBy === id) {
      throw new CarnetError('INVALID_NOTE', `Note #${id} cannot replace itself`);
    }
    requireActiveNote(ctx, input.replacedBy);
  }
  const replacedBy = input.replacedBy === undefined ? null : noteId(ctx, input.replacedBy);
  ctx.db
    .prepare(
      'UPDATE notes SET dropped_at = ?, dropped_reason = ?, dropped_session = ?, replaced_by = ? WHERE id = ?',
    )
    .run(nowIso(ctx), reason, input.session ?? null, replacedBy, noteId(ctx, id));
  return requireNote(ctx, id);
}

export function citeNote(ctx: Ctx, id: number, input: CiteNoteInput): NoteCitation {
  requireActiveNote(ctx, id);
  const why = cleanText(input.why, 'Citation reason');
  const result = ctx.db
    .prepare('INSERT INTO note_citations (note, session, agent, why, at) VALUES (?, ?, ?, ?, ?)')
    .run(noteId(ctx, id), input.session ?? null, input.agent ?? null, why, nowIso(ctx));
  return ctx.db
    .prepare(
      `SELECT ${CITATION_COLUMNS} FROM note_citations JOIN notes ON notes.id = note_citations.note
       WHERE note_citations.id = ?`,
    )
    .get(Number(result.lastInsertRowid)) as unknown as NoteCitation;
}

export type NoteActivityKind = 'added' | 'cited' | 'dropped';

export interface NoteActivity {
  activity: NoteActivityKind;
  note: number;
  kind: NoteKind;
  text: string;
  similarNotes: number[];
  replacedBy: number | null;
  at: string;
}

const ACTIVITY_ORDER: Record<NoteActivityKind, number> = { dropped: 0, cited: 1, added: 2 };

function activeIds(ctx: Ctx, json: string | null): number[] {
  if (!json) return [];
  const active = ctx.db.prepare(
    'SELECT 1 FROM notes WHERE workspace IS ? AND number = ? AND dropped_at IS NULL',
  );
  return (JSON.parse(json) as number[]).filter(
    (number) => active.get(ctx.workspace, number) !== undefined,
  );
}

export function sessionNoteActivity(ctx: Ctx, session: string): NoteActivity[] {
  const added = ctx.db
    .prepare(
      `SELECT number, kind, text, similar_notes, created_at FROM notes
       WHERE workspace IS ? AND session = ?`,
    )
    .all(ctx.workspace, session) as unknown as Pick<
    NoteRow,
    'number' | 'kind' | 'text' | 'similar_notes' | 'created_at'
  >[];
  const cited = ctx.db
    .prepare(
      `SELECT notes.number AS note, notes.kind, note_citations.why, note_citations.at
       FROM note_citations JOIN notes ON notes.id = note_citations.note
       WHERE notes.workspace IS ? AND note_citations.session = ?`,
    )
    .all(ctx.workspace, session) as unknown as {
    note: number;
    kind: NoteKind;
    why: string;
    at: string;
  }[];
  const dropped = ctx.db
    .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE workspace IS ? AND dropped_session = ?`)
    .all(ctx.workspace, session) as unknown as NoteRow[];
  const activity: NoteActivity[] = [
    ...added.map((row) => ({
      activity: 'added' as const,
      note: row.number,
      kind: row.kind,
      text: row.text,
      similarNotes: activeIds(ctx, row.similar_notes),
      replacedBy: null,
      at: row.created_at,
    })),
    ...cited.map((row) => ({
      activity: 'cited' as const,
      note: row.note,
      kind: row.kind,
      text: row.why,
      similarNotes: [],
      replacedBy: null,
      at: row.at,
    })),
    ...dropped.map((row) => ({
      activity: 'dropped' as const,
      note: row.number,
      kind: row.kind,
      text: row.dropped_reason ?? '',
      similarNotes: [],
      replacedBy: row.replaced_number,
      at: row.dropped_at ?? '',
    })),
  ];
  return activity.sort(
    (first, second) =>
      second.at.localeCompare(first.at) ||
      ACTIVITY_ORDER[first.activity] - ACTIVITY_ORDER[second.activity] ||
      second.note - first.note,
  );
}

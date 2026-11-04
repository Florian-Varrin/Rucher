import { type Ctx, nowIso } from './context.ts';
import type { Group } from './group/locate.ts';
import {
  compareNotes,
  DEFAULT_HALF_LIFE_DAYS,
  listNotes,
  NOTE_KINDS,
  type NoteKind,
  type WeightedNote,
} from './notes.ts';

export const MEMORY_MAX_CHARACTERS = 2000;

const KIND_TITLES: Readonly<Record<NoteKind, string>> = {
  dead_end: 'Dead ends',
  decision: 'Decisions',
  learning: 'Learnings',
};

// Cut first what loses least: learnings, then decisions; dead ends go last.
const CUT_ORDER: readonly NoteKind[] = ['learning', 'decision', 'dead_end'];

export function memoryMaxCharacters(value: string | undefined): number {
  const characters = Number(value);
  return Number.isInteger(characters) && characters > 0 ? characters : MEMORY_MAX_CHARACTERS;
}

export interface MemoryOptions {
  maxCharacters?: number | undefined;
  halfLifeDays?: number | undefined;
}

interface MemoryScope {
  title: string;
  notes: WeightedNote[];
}

function noteLine(note: WeightedNote): string {
  const repos = note.repos.length ? `[${note.repos.join(', ')}] ` : '';
  return `  #${String(note.id).padEnd(4)}${repos}${note.text}`;
}

function render(scope: MemoryScope, kept: WeightedNote[]): string {
  const total = scope.notes.length;
  const leftOut = total - kept.length;
  const count = `${total} note${total > 1 ? 's' : ''}`;
  const pointer = leftOut ? `${leftOut} left out, note_list for the rest` : 'note_list for details';
  const lines = [`${scope.title} (${count}, ${pointer}):`];
  for (const kind of NOTE_KINDS) {
    const ofKind = kept.filter((note) => note.kind === kind);
    if (!ofKind.length) continue;
    lines.push('', KIND_TITLES[kind], ...ofKind.map(noteLine));
  }
  return lines.join('\n');
}

export function renderMemory(scope: MemoryScope, maxCharacters = MEMORY_MAX_CHARACTERS): string {
  const kept = [...scope.notes];
  let text = render(scope, kept);
  while (text.length > maxCharacters && kept.length) {
    const kind = CUT_ORDER.find((candidate) => kept.some((note) => note.kind === candidate));
    const lowest = kept.findLastIndex((note) => note.kind === kind);
    kept.splice(lowest, 1);
    text = render(scope, kept);
  }
  return text.length > maxCharacters ? `${text.slice(0, maxCharacters - 1)}…` : text;
}

function injectedRepos(ctx: Ctx, session: string): string[] {
  const rows = ctx.db
    .prepare('SELECT repo FROM session_repos WHERE session = ? ORDER BY injected_at, repo')
    .all(session) as unknown as { repo: string }[];
  return rows.map((row) => row.repo);
}

function recordRepo(ctx: Ctx, session: string, repo: string): void {
  ctx.db
    .prepare('INSERT OR IGNORE INTO session_repos (session, repo, injected_at) VALUES (?, ?, ?)')
    .run(session, repo, nowIso(ctx));
}

function notesFor(ctx: Ctx, repos: string[], general: boolean, halfLifeDays: number) {
  const byId = new Map<number, WeightedNote>();
  const add = (notes: WeightedNote[]) => notes.forEach((note) => byId.set(note.id, note));
  if (general) add(listNotes(ctx, { general: true, halfLifeDays }));
  for (const repo of repos) add(listNotes(ctx, { repo, halfLifeDays }));
  return [...byId.values()].sort(compareNotes);
}

function groupTitle(group: Group | null): string {
  return group ? `Rucher memory of the ${group.name} group` : 'Rucher memory';
}

export function sessionStartMemory(
  ctx: Ctx,
  group: Group | null,
  session: { id: string; repo: string | null },
  options: MemoryOptions = {},
): string | undefined {
  const halfLifeDays = options.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const repos = session.repo ? [session.repo] : [];
  const notes = notesFor(ctx, repos, true, halfLifeDays);
  if (!notes.length) return undefined;
  for (const repo of repos) {
    if (notes.some((note) => note.repos.includes(repo))) recordRepo(ctx, session.id, repo);
  }
  return renderMemory({ title: groupTitle(group), notes }, options.maxCharacters);
}

export function sessionMemory(
  ctx: Ctx,
  group: Group | null,
  session: { id: string },
  options: MemoryOptions = {},
): string | undefined {
  const halfLifeDays = options.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const notes = notesFor(ctx, injectedRepos(ctx, session.id), true, halfLifeDays);
  if (!notes.length) return undefined;
  return renderMemory({ title: groupTitle(group), notes }, options.maxCharacters);
}

export function repoMemory(
  ctx: Ctx,
  session: { id: string },
  repo: string,
  options: MemoryOptions = {},
): string | undefined {
  const injected = injectedRepos(ctx, session.id);
  if (injected.includes(repo)) return undefined;
  const halfLifeDays = options.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  // A note shared with a repo already injected is already in context.
  const notes = listNotes(ctx, { repo, halfLifeDays }).filter(
    (note) => !note.repos.some((other) => injected.includes(other)),
  );
  if (!notes.length) return undefined;
  recordRepo(ctx, session.id, repo);
  return renderMemory({ title: `Rucher memory, repo ${repo}`, notes }, options.maxCharacters);
}

export function copyInjectedRepos(ctx: Ctx, from: string, into: string): void {
  for (const repo of injectedRepos(ctx, from)) recordRepo(ctx, into, repo);
}

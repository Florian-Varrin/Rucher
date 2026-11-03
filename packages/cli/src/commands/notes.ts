import {
  type Carnet,
  groupLabel,
  formatClock,
  memoryHalfLife,
  type Note,
  NOTE_KINDS,
  type NoteKind,
  shortId,
  type WeightedNote,
} from '@rucher/carnet';
import { paint } from '../color.ts';
import type { Io } from '../io.ts';
import { CliError } from '../session.ts';

export const KIND_TITLES: Record<NoteKind, string> = {
  dead_end: 'Dead ends',
  decision: 'Decisions',
  learning: 'Learnings',
};

export interface NotesListOptions {
  all?: boolean | undefined;
  kind?: string | undefined;
  repo?: string | undefined;
  general?: boolean | undefined;
  stale?: boolean | undefined;
  markdown?: boolean | undefined;
}

// citty keeps only the last value of a repeated flag.
export function repoList(rawArguments: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < rawArguments.length; index++) {
    const argument = rawArguments[index] ?? '';
    if (argument === '--repo') values.push(rawArguments[++index] ?? '');
    else if (argument.startsWith('--repo=')) values.push(argument.slice('--repo='.length));
  }
  return values
    .flatMap((value) => value.split(','))
    .map((repo) => repo.trim())
    .filter(Boolean);
}

export function parseNoteId(value: string): number {
  const id = Number(value.replace(/^#/, ''));
  if (!Number.isInteger(id) || id <= 0) {
    throw new CliError(
      `Invalid note id "${value}"`,
      'use the number shown by rucher notes, e.g. 14',
    );
  }
  return id;
}

function halfLife(io: Io): number {
  return memoryHalfLife(io.env['RUCHER_MEMORY_HALF_LIFE_DAYS']);
}

function reposLabel(note: Note): string {
  return note.repos.length ? `[${note.repos.join(', ')}] ` : '';
}

function noteLine(io: Io, note: WeightedNote): string {
  const colors = paint(io);
  const extras = [
    note.citationCount ? `cited ${note.citationCount}` : '',
    note.similarNotes.length
      ? colors.yellow(`similar to ${note.similarNotes.map((id) => `#${id}`).join(', ')}`)
      : '',
    note.droppedAt ? colors.dim(`dropped: ${note.droppedReason ?? ''}`) : '',
  ].filter(Boolean);
  const text = `${reposLabel(note)}${note.text}`;
  const line = `  ${colors.bold(`#${note.id}`.padEnd(5))} ${note.droppedAt ? colors.dim(text) : text}`;
  return extras.length ? `${line}  ${colors.dim('·')} ${extras.join(colors.dim(' · '))}` : line;
}

function grouped(notes: WeightedNote[]): [NoteKind, WeightedNote[]][] {
  return NOTE_KINDS.map(
    (kind) => [kind, notes.filter((note) => note.kind === kind)] as [NoteKind, WeightedNote[]],
  ).filter(([, kindNotes]) => kindNotes.length > 0);
}

function markdown(carnet: Carnet, notes: WeightedNote[]): string {
  const sections = grouped(notes).map(([kind, kindNotes]) => {
    const lines = kindNotes.map((note) => {
      const dropped = note.droppedAt ? ` (dropped: ${note.droppedReason ?? ''})` : '';
      return `- #${note.id} ${reposLabel(note)}${note.text}${dropped}`;
    });
    return `## ${KIND_TITLES[kind]}\n\n${lines.join('\n')}`;
  });
  return `# Memory: ${groupLabel(carnet.group)}\n\n${sections.join('\n\n') || 'No notes.'}\n`;
}

export function notesList(carnet: Carnet, io: Io, options: NotesListOptions = {}): void {
  const notes = options.stale
    ? carnet.notes.stale(halfLife(io))
    : carnet.notes.list({
        kind: options.kind,
        repo: options.repo,
        general: options.general,
        includeDropped: options.all,
        halfLifeDays: halfLife(io),
      });
  if (options.markdown) {
    io.stdout(markdown(carnet, notes));
    return;
  }
  const colors = paint(io);
  if (notes.length === 0) {
    io.stdout(`${colors.dim(options.stale ? 'no note to review' : 'no notes')}\n`);
    return;
  }
  const blocks = grouped(notes).map(
    ([kind, kindNotes]) =>
      `${colors.bold(KIND_TITLES[kind])}\n${kindNotes.map((note) => noteLine(io, note)).join('\n')}`,
  );
  io.stdout(`${blocks.join('\n\n')}\n`);
}

function sessionLabel(carnet: Carnet, id: string | null): string {
  if (!id) return '-';
  return carnet.sessions.get(id)?.name ?? shortId(id);
}

function when(at: string): string {
  const date = new Date(at);
  return `${at.slice(0, 10)} ${formatClock(date)}`;
}

export function notesShow(carnet: Carnet, io: Io, id: number): void {
  const colors = paint(io);
  const note = carnet.notes.show(id, halfLife(io));
  const lines = [
    `${colors.bold(`#${note.id}`)} ${note.kind}${note.droppedAt ? colors.dim(' (dropped)') : ''}`,
    note.text,
    `repos: ${note.repos.length ? note.repos.join(', ') : 'general'}`,
    `added: ${when(note.createdAt)} in ${sessionLabel(carnet, note.session)}${note.agent ? `, from ${note.agent}` : ''}`,
    `weight: ${note.weight.toFixed(2)} · ${note.citationCount} citation${note.citationCount === 1 ? '' : 's'}`,
  ];
  if (note.similarNotes.length) {
    lines.push(
      colors.yellow(`similar to: ${note.similarNotes.map((other) => `#${other}`).join(', ')}`),
    );
  }
  if (note.droppedAt) {
    const replaced = note.replacedBy ? `, replaced by #${note.replacedBy}` : '';
    lines.push(`dropped: ${when(note.droppedAt)}: ${note.droppedReason ?? ''}${replaced}`);
  }
  if (note.citations.length) {
    lines.push('citations:');
    for (const citation of note.citations) {
      const by = citation.agent ? `  ${citation.agent}` : '';
      lines.push(
        `  ${when(citation.at)}  ${sessionLabel(carnet, citation.session)}${by}  ${citation.why}`,
      );
    }
  }
  io.stdout(`${lines.join('\n')}\n`);
}

export function notesAdd(
  carnet: Carnet,
  io: Io,
  input: { kind: string; text: string; repos: string[] },
): void {
  const { note, similar } = carnet.notes.add({
    kind: input.kind,
    text: input.text,
    repos: input.repos,
  });
  io.stdout(`added #${note.id} ${note.kind} ${reposLabel(note)}${note.text}\n`);
  if (similar.length) {
    const colors = paint(io);
    io.stdout(
      `${colors.yellow('similar active notes, possible duplicate:')}\n${similar.map((other) => `  #${other.id} ${reposLabel(other)}${other.text}`).join('\n')}\n`,
    );
  }
}

export function notesDrop(
  carnet: Carnet,
  io: Io,
  id: number,
  input: { reason: string; replacedBy?: number | undefined },
): void {
  const note = carnet.notes.drop(id, input);
  const replaced = note.replacedBy ? `, replaced by #${note.replacedBy}` : '';
  io.stdout(`dropped #${note.id}${replaced}\n`);
}

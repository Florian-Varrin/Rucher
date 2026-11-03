import type { NoteActivity } from '../notes.ts';
import type { TableItem } from '../table.ts';
import { EMOJI, LEGEND, MAIN_WORKING_EMOJI } from './model.ts';
import type { StatusLine, StatusView } from './view.ts';

export const MAIN_WORKING_SUFFIX = '(main working, not ready)';

export function renderTableLine(item: TableItem): string {
  if (item.mainWorking) return `${MAIN_WORKING_EMOJI} ${item.text} ${MAIN_WORKING_SUFFIX}`;
  return `${EMOJI[item.status ?? 'discussing']} ${item.text}`;
}

export function renderAgentLine(line: StatusLine): string {
  return line.note ? `${line.emoji} ${line.name} — ${line.note}` : `${line.emoji} ${line.name}`;
}

export const NOTES_HEADER = 'Notes';
export const NOTES_FOLD_LINES = 5;
const ACTIVITY_MARK = { added: '+', cited: '★', dropped: '−' } as const;
const LABEL_WIDTH = 'dead_end'.length;
export const SIMILAR_PREFIX = 'similar to ';

export type NotesMode = 'full' | 'summary';

export interface RenderOptions {
  notes?: NotesMode | undefined;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? 's' : ''}`;
}

export function renderNotesSummary(notes: NoteActivity[]): string {
  const count = (activity: NoteActivity['activity']) =>
    notes.filter((item) => item.activity === activity).length;
  const duplicates = notes.filter(
    (item) => item.activity === 'added' && item.similarNotes.length > 0,
  ).length;
  const parts = [
    count('added') && `${count('added')} added`,
    count('cited') && `${count('cited')} cited`,
    count('dropped') && `${count('dropped')} dropped`,
    duplicates && plural(duplicates, 'possible duplicate'),
  ].filter(Boolean);
  return `${NOTES_HEADER}  ${parts.join(' · ')}`;
}

export function renderNoteLine(item: NoteActivity, idWidth: number): string {
  const id = `#${item.note}`.padEnd(idWidth);
  const label = (item.activity === 'added' ? item.kind : item.activity).padEnd(LABEL_WIDTH);
  let text = item.text;
  // Before the text, so a narrow terminal cuts the note rather than the duplicate warning.
  if (item.activity === 'added' && item.similarNotes.length > 0) {
    text = `${SIMILAR_PREFIX}${item.similarNotes.map((note) => `#${note}`).join(', ')} · ${text}`;
  }
  if (item.activity === 'dropped' && item.replacedBy !== null)
    text = `replaced by #${item.replacedBy}`;
  return `${ACTIVITY_MARK[item.activity]} ${id}  ${label}  ${text}`;
}

export function renderNotes(notes: NoteActivity[], mode: NotesMode = 'full'): string[] {
  if (notes.length === 0) return [];
  if (mode === 'summary' || notes.length > NOTES_FOLD_LINES) return [renderNotesSummary(notes)];
  const idWidth = Math.max(...notes.map((item) => `#${item.note}`.length));
  return [NOTES_HEADER, ...notes.map((item) => `  ${renderNoteLine(item, idWidth)}`)];
}

export function renderSections(view: StatusView, options: RenderOptions = {}): string {
  const out: string[] = [];
  if (view.table) {
    out.push('On the table', `  ${renderTableLine(view.table)}`, '');
  }
  out.push('Waiting on you');
  if (view.waiting.length === 0) out.push('  nothing');
  view.waiting.forEach((line, index) => {
    out.push(`  ${index + 1}. ${renderAgentLine(line)}`);
  });
  out.push('', 'Running');
  if (view.running.length === 0) out.push('  nothing');
  for (const line of view.running) out.push(`  ${renderAgentLine(line)}`);
  const notes = renderNotes(view.notes, options.notes);
  if (notes.length > 0) out.push('', ...notes);
  return out.join('\n');
}

export function renderStatus(view: StatusView, options?: RenderOptions): string {
  return [view.time, '', renderSections(view, options), '', LEGEND].join('\n');
}

import {
  type Carnet,
  LEGEND,
  NOTES_HEADER,
  type NotesMode,
  SIMILAR_PREFIX,
  renderSections,
  type Session,
  type StatusView,
} from '@rucher/carnet';
import { paint } from '../color.ts';
import type { Io } from '../io.ts';
import { resolveSession } from '../session.ts';
import { INITIAL_WATCH_STATE, type Key, pressKey, type WatchState } from './watch-keys.ts';

export interface StatusOptions {
  session?: string | undefined;
  all?: boolean | undefined;
  interaction?: WatchState | undefined;
}

const SECTION_HEADERS = new Set(['On the table', 'Waiting on you', 'Running', NOTES_HEADER]);

function truncate(line: string, columns: number): string {
  const chars = Array.from(line);
  return chars.length > columns ? `${chars.slice(0, Math.max(columns - 1, 1)).join('')}…` : line;
}

function colorizeLine(line: string, io: Io): string {
  const colors = paint(io);
  if (line === LEGEND) return colors.dim(line);
  const cut = truncate(line, io.columns);
  if (SECTION_HEADERS.has(line)) return colors.bold(cut);
  if (line.startsWith('  ⚙️')) return colors.yellow(cut);
  if (line === '  nothing') return colors.dim(cut);
  if (cut.startsWith(`${NOTES_HEADER}  `)) {
    return `${colors.bold(NOTES_HEADER)}${cut.slice(NOTES_HEADER.length)}`;
  }
  const marker = /^ {2}\+ #\d+ +\S+ {2}(similar to [^·]*·)/.exec(cut);
  if (marker?.[1]) {
    const start = cut.indexOf(SIMILAR_PREFIX);
    const end = start + marker[1].length;
    return `${cut.slice(0, start)}${colors.yellow(cut.slice(start, end))}${cut.slice(end)}`;
  }
  return cut;
}

export function colorizeStatus(text: string, io: Io): string {
  const [time = '', ...rest] = text.split('\n');
  return [paint(io).dim(time), ...rest.map((line) => colorizeLine(line, io))].join('\n');
}

function sessionName(session: Session): string {
  return session.name ?? session.id.slice(0, 8);
}

function sessionLabel(carnet: Carnet, session: Session, columns: number): string {
  const name = sessionName(session);
  // The name identifies the pane: only the group gives way to a narrow terminal.
  const room = columns - Array.from(name).length - 3;
  return room > 1 ? `${name} · ${truncate(carnet.group.name, room)}` : name;
}

function sessionHeader(session: Session, io: Io): string {
  return paint(io).cyan(truncate(sessionName(session), io.columns));
}

function sessionLines(
  session: Session,
  view: StatusView,
  io: Io,
  notes: NotesMode = 'full',
): string[] {
  if (session.status === 'archived')
    return [paint(io).dim('  archived, see rucher sessions --all')];
  return renderSections(view, { notes })
    .split('\n')
    .map((line) => colorizeLine(line, io));
}

export const SELECTED_MARK = '›';
export const KEYS_HINT = 'n fold · ↑↓ select · enter detail · d drop · q quit';

function noteDetailLines(carnet: Carnet, id: number): string[] {
  const note = carnet.notes.show(id);
  const lines = [`    ${note.text}`];
  if (note.repos.length > 0) lines.push(`    repos: ${note.repos.join(', ')}`);
  const status = note.droppedAt ? `dropped: ${note.droppedReason ?? ''}` : 'active';
  lines.push(`    ${status} · weight ${note.weight.toFixed(2)} · ${note.citationCount} cited`);
  for (const citation of note.citations)
    lines.push(`    ★ ${citation.at.slice(0, 10)}  ${citation.why}`);
  return lines;
}

function interactiveLines(
  carnet: Carnet,
  session: Session,
  view: StatusView,
  io: Io,
  state: WatchState,
): string[] {
  if (!state.notesOpen || session.status === 'archived') return sessionLines(session, view, io);
  const colors = paint(io);
  const raw = renderSections(view, { notes: 'expanded' }).split('\n');
  const header = raw.indexOf(NOTES_HEADER);
  const selected = Math.min(state.selected, view.notes.length - 1);
  return raw.flatMap((line, index) => {
    const position = index - header - 1;
    if (header === -1 || position !== selected) return [colorizeLine(line, io)];
    const marked = colors.cyan(truncate(`${SELECTED_MARK}${line.slice(1)}`, io.columns));
    const note = view.notes[selected];
    if (!state.detail || !note) return [marked];
    return [
      marked,
      ...noteDetailLines(carnet, note.note).map((detail) => truncate(detail, io.columns)),
    ];
  });
}

function footerLine(view: StatusView, io: Io, state: WatchState | undefined): string | null {
  if (!state) return null;
  const colors = paint(io);
  if (state.reason !== null) {
    const note = view.notes[Math.min(state.selected, view.notes.length - 1)];
    return colors.yellow(`drop #${note?.note ?? '?'}, reason: ${state.reason}`);
  }
  if (state.message) return colors.red(state.message);
  return state.notesOpen ? colors.dim(KEYS_HINT) : null;
}

function hasSomethingToShow(carnet: Carnet, session: Session): boolean {
  return (
    carnet.agents.list(session.id).length > 0 ||
    carnet.table.get(session.id) !== undefined ||
    carnet.notes.activity(session.id).length > 0
  );
}

function sessionBlock(session: Session, view: StatusView, io: Io): string {
  return [sessionHeader(session, io), ...sessionLines(session, view, io, 'summary')].join('\n');
}

function singleView(carnet: Carnet, session: Session, io: Io, state?: WatchState): string {
  const colors = paint(io);
  const view = carnet.status.view(session);
  const separator = ' - ';
  const label = sessionLabel(carnet, session, io.columns - view.time.length - separator.length);
  const title = `${colors.dim(view.time)}${separator}${colors.cyan(label)}`;
  const body = state
    ? interactiveLines(carnet, session, view, io, state)
    : sessionLines(session, view, io);
  const footer = footerLine(view, io, state);
  return [title, '', ...body, '', ...(footer ? [footer] : []), colors.dim(LEGEND)].join('\n');
}

export function renderStatusView(carnet: Carnet, io: Io, options: StatusOptions): string {
  const sessions = options.all
    ? carnet.sessions
        .list({ includeTemp: true })
        .filter((session) => hasSomethingToShow(carnet, session))
    : [];
  if (sessions.length === 0) {
    return singleView(carnet, resolveSession(carnet, options.session), io, options.interaction);
  }
  let time = '';
  const blocks = sessions.map((session) => {
    const view = carnet.status.view(session);
    time ||= view.time;
    return sessionBlock(session, view, io);
  });
  const colors = paint(io);
  const separator = ' - ';
  const group = truncate(carnet.group.name, io.columns - time.length - separator.length);
  const title = `${colors.dim(time)}${separator}${colors.cyan(group)}`;
  return [title, '', blocks.join('\n\n'), '', colors.dim(LEGEND)].join('\n');
}

export function statusOnce(carnet: Carnet, io: Io, options: StatusOptions): void {
  io.stdout(`${renderStatusView(carnet, io, options)}\n`);
}

export interface KeySource {
  onKey: (listener: (key: Key) => void) => void;
  close: () => void;
}

export interface WatchOptions extends StatusOptions {
  intervalMilliseconds: number;
  signal?: AbortSignal;
  keys?: KeySource | undefined;
}

function dropSelected(carnet: Carnet, options: WatchOptions, index: number, reason: string) {
  const session = resolveSession(carnet, options.session);
  const item = carnet.notes.activity(session.id)[index];
  if (!item) return 'no note selected';
  try {
    carnet.notes.drop(item.note, { reason, session: session.id });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function noteCount(carnet: Carnet, options: WatchOptions): number {
  try {
    return carnet.notes.activity(resolveSession(carnet, options.session).id).length;
  } catch {
    return 0;
  }
}

const CLEAR = '\x1b[H\x1b[2J';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

export function statusWatch(carnet: Carnet, io: Io, options: WatchOptions): Promise<void> {
  return new Promise((resolve) => {
    let last = '';
    const interactive = options.keys !== undefined && !options.all;
    let state = INITIAL_WATCH_STATE;
    const repaint = () => {
      let text: string;
      try {
        text = renderStatusView(carnet, io, {
          ...options,
          interaction: interactive ? state : undefined,
        });
      } catch (error) {
        text = paint(io).dim(error instanceof Error ? error.message : String(error));
      }
      if (text === last) return;
      last = text;
      io.stdout(`${CLEAR}${text}\n`);
    };
    // Typing a reason pauses the refresh so the prompt line stays put.
    const timer = setInterval(() => {
      if (state.reason === null) repaint();
    }, options.intervalMilliseconds);
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      options.keys?.close();
      io.stdout(SHOW_CURSOR);
      resolve();
    };
    options.keys?.onKey((key) => {
      const result = pressKey(state, key, interactive ? noteCount(carnet, options) : 0);
      state = result.state;
      if (result.action?.type === 'quit') return stop();
      if (result.action?.type === 'drop') {
        state = {
          ...state,
          message: dropSelected(carnet, options, result.action.index, result.action.reason),
        };
      }
      repaint();
    });
    options.signal?.addEventListener('abort', stop, { once: true });
    io.stdout(HIDE_CURSOR);
    repaint();
  });
}

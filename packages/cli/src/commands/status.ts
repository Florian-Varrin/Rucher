import { type Carnet, LEGEND, repoPathFor, type Session } from '@rucher/carnet';
import { paint } from '../color.ts';
import type { Io } from '../io.ts';
import { resolveSession } from '../session.ts';

export interface StatusOptions {
  session?: string | undefined;
  all?: boolean | undefined;
}

const SECTION_HEADERS = new Set(['On the table', 'Waiting on you', 'Running']);

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
  return cut;
}

export function colorizeStatus(text: string, io: Io): string {
  const [time = '', ...rest] = text.split('\n');
  return [paint(io).dim(time), ...rest.map((line) => colorizeLine(line, io))].join('\n');
}

export function sessionWhere(carnet: Carnet, session: Session): string | null {
  return repoPathFor(carnet.group, session.cwd) ?? session.repo;
}

function sessionHeader(carnet: Carnet, session: Session, io: Io): string {
  const colors = paint(io);
  const name = session.name ?? session.id.slice(0, 8);
  const where = sessionWhere(carnet, session);
  return colors.cyan(truncate(`${name}${where ? ` · ${where}` : ''}`, io.columns));
}

function hasSomethingToShow(carnet: Carnet, session: Session): boolean {
  return carnet.agents.list(session.id).length > 0 || carnet.table.get(session.id) !== undefined;
}

export function renderStatusView(carnet: Carnet, io: Io, options: StatusOptions): string {
  if (!options.all) {
    return colorizeStatus(carnet.status.render(resolveSession(carnet, options.session)), io);
  }
  const active = carnet.sessions
    .list({ includeTemporary: true })
    .filter((session) => hasSomethingToShow(carnet, session));
  const [first = resolveSession(carnet), ...others] = active;
  const sessions = [first, ...others];
  const blocks = sessions.map((session) => {
    const sections = carnet.status.sections(session).split('\n');
    return [
      sessionHeader(carnet, session, io),
      ...sections.map((line) => colorizeLine(line, io)),
    ].join('\n');
  });
  const time = paint(io).dim(carnet.status.view(first).time);
  return [time, '', blocks.join('\n\n'), '', paint(io).dim(LEGEND)].join('\n');
}

export function statusOnce(carnet: Carnet, io: Io, options: StatusOptions): void {
  io.stdout(`${renderStatusView(carnet, io, options)}\n`);
}

export interface WatchOptions extends StatusOptions {
  intervalMilliseconds: number;
  signal?: AbortSignal;
}

const CLEAR = '\x1b[H\x1b[2J';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

export function statusWatch(carnet: Carnet, io: Io, options: WatchOptions): Promise<void> {
  return new Promise((resolve) => {
    let last = '';
    const repaint = () => {
      let text: string;
      try {
        text = renderStatusView(carnet, io, options);
      } catch (error) {
        text = paint(io).dim(error instanceof Error ? error.message : String(error));
      }
      if (text === last) return;
      last = text;
      io.stdout(`${CLEAR}${text}\n`);
    };
    const timer = setInterval(repaint, options.intervalMilliseconds);
    const stop = () => {
      clearInterval(timer);
      io.stdout(SHOW_CURSOR);
      resolve();
    };
    options.signal?.addEventListener('abort', stop, { once: true });
    io.stdout(HIDE_CURSOR);
    repaint();
  });
}

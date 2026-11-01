import { type Carnet, LEGEND, type Session } from "@rucher/carnet";
import { paint } from "../color.ts";
import type { Io } from "../io.ts";
import { resolveSession } from "../session.ts";

export interface StatusOptions {
  session?: string;
  all?: boolean;
}

const SECTION_HEADERS = new Set(["On the table", "Waiting on you", "Running"]);

function truncate(line: string, columns: number): string {
  const chars = Array.from(line);
  return chars.length > columns ? `${chars.slice(0, Math.max(columns - 1, 1)).join("")}…` : line;
}

export function colorizeStatus(text: string, io: Io): string {
  const p = paint(io);
  const lines = text.split("\n");
  return lines
    .map((line, index) => {
      if (index === 0 || line === LEGEND) return p.dim(line);
      const cut = truncate(line, io.columns);
      if (SECTION_HEADERS.has(line)) return p.bold(cut);
      if (line.startsWith("  ⚙️")) return p.yellow(cut);
      if (line === "  nothing") return p.dim(cut);
      return cut;
    })
    .join("\n");
}

function sessionHeader(session: Session, io: Io): string {
  const p = paint(io);
  const name = session.name ?? session.id.slice(0, 8);
  return p.cyan(`${name}${session.repo ? ` · ${session.repo}` : ""}`);
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
    .filter((s) => hasSomethingToShow(carnet, s));
  const sessions = active.length ? active : [resolveSession(carnet)];
  return sessions
    .map((s) => `${sessionHeader(s, io)}\n${colorizeStatus(carnet.status.render(s), io)}`)
    .join("\n\n");
}

export function statusOnce(carnet: Carnet, io: Io, options: StatusOptions): void {
  io.stdout(`${renderStatusView(carnet, io, options)}\n`);
}

export interface WatchOptions extends StatusOptions {
  intervalMs: number;
  signal?: AbortSignal;
}

const CLEAR = "\x1b[H\x1b[2J";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

export function statusWatch(carnet: Carnet, io: Io, options: WatchOptions): Promise<void> {
  return new Promise((resolve) => {
    let last = "";
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
    const timer = setInterval(repaint, options.intervalMs);
    const stop = () => {
      clearInterval(timer);
      io.stdout(SHOW_CURSOR);
      resolve();
    };
    options.signal?.addEventListener("abort", stop, { once: true });
    io.stdout(HIDE_CURSOR);
    repaint();
  });
}

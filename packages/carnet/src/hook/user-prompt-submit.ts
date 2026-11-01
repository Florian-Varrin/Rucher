import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import type { Carnet } from '../carnet.ts';
import type { Session } from '../sessions.ts';

export interface HookPromptPayload {
  session_id: string;
  cwd?: string | undefined;
  session_title?: string | undefined;
  transcript_path?: string | undefined;
}

const TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const TITLE_PATTERN = /"type":"custom-title","customTitle":("(?:[^"\\]|\\.)*")/g;

export function parsePromptPayload(json: string): HookPromptPayload {
  const data = JSON.parse(json) as Record<string, unknown>;
  if (typeof data.session_id !== 'string' || !data.session_id) {
    throw new TypeError('Hook payload has no session_id');
  }
  const text = (key: string) => (typeof data[key] === 'string' ? data[key] : undefined);
  return {
    session_id: data.session_id,
    cwd: text('cwd'),
    session_title: text('session_title'),
    transcript_path: text('transcript_path'),
  };
}

export function transcriptTitle(path: string): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, 'r');
    const size = fstatSync(descriptor).size;
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, size - length);
    const matches = [...buffer.toString('utf8').matchAll(TITLE_PATTERN)];
    const last = matches.at(-1)?.[1];
    return last === undefined ? undefined : (JSON.parse(last) as string);
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

// `/rename` fires no hook of its own; the next prompt carries the new title.
export function handleUserPromptSubmit(carnet: Carnet, payload: HookPromptPayload): Session {
  const title =
    payload.session_title ??
    (payload.transcript_path ? transcriptTitle(payload.transcript_path) : undefined);
  carnet.sessions.ensure(payload.session_id, payload.cwd);
  return carnet.sessions.adoptTitle(payload.session_id, title);
}

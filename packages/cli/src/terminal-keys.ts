import { emitKeypressEvents } from 'node:readline';
import type { KeySource } from './commands/status.ts';
import type { Key } from './commands/watch-keys.ts';

export interface KeyTerminal {
  isTTY?: boolean | undefined;
  setRawMode?: ((mode: boolean) => unknown) | undefined;
  on: (event: 'keypress', listener: (sequence: string, key: Key | undefined) => void) => unknown;
  off: (event: 'keypress', listener: (sequence: string, key: Key | undefined) => void) => unknown;
  resume: () => unknown;
  pause: () => unknown;
}

export interface KeyProcess {
  once: (event: 'exit', listener: () => void) => unknown;
}

export function terminalKeys(
  input: KeyTerminal,
  output: { isTTY?: boolean | undefined },
  owner: KeyProcess = process,
): KeySource | undefined {
  if (!input.isTTY || !output.isTTY || !input.setRawMode) return undefined;
  emitKeypressEvents(input as NodeJS.ReadStream);
  let listener: ((sequence: string, key: Key | undefined) => void) | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (listener) input.off('keypress', listener);
    input.setRawMode?.(false);
    input.pause();
  };
  input.setRawMode(true);
  input.resume();
  // A crash or an exit that skips close() must not leave the shell in raw mode.
  owner.once('exit', close);
  return {
    onKey: (onKey) => {
      listener = (sequence, key) => onKey(key ?? { sequence });
      input.on('keypress', listener);
    },
    close,
  };
}

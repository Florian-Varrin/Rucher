import { EventEmitter } from 'node:events';
import { expect, test } from 'vite-plus/test';
import { renderStatusView, statusWatch, type KeySource } from '../src/commands/status.ts';
import {
  INITIAL_WATCH_STATE,
  type Key,
  pressKey,
  type WatchState,
} from '../src/commands/watch-keys.ts';
import { terminalKeys } from '../src/terminal-keys.ts';
import { makeCarnet, makeIo, SESSION } from './helpers.ts';

function press(state: WatchState, names: string[], count = 3): WatchState {
  return names.reduce((current, name) => pressKey(current, { name }, count).state, state);
}

test('n unfolds and folds the notes, only when there are notes', () => {
  expect(press(INITIAL_WATCH_STATE, ['n']).notesOpen).toBe(true);
  expect(press(INITIAL_WATCH_STATE, ['n', 'n']).notesOpen).toBe(false);
  expect(pressKey(INITIAL_WATCH_STATE, { name: 'n' }, 0).state.notesOpen).toBe(false);
});

test('arrows move the selection within the notes, only when unfolded', () => {
  expect(press(INITIAL_WATCH_STATE, ['down']).selected).toBe(0);
  expect(press(INITIAL_WATCH_STATE, ['n', 'down', 'down', 'down', 'down']).selected).toBe(2);
  expect(press(INITIAL_WATCH_STATE, ['n', 'down', 'up', 'up']).selected).toBe(0);
});

test('enter opens and closes the detail, escape closes it', () => {
  expect(press(INITIAL_WATCH_STATE, ['n', 'return']).detail).toBe(true);
  expect(press(INITIAL_WATCH_STATE, ['n', 'return', 'return']).detail).toBe(false);
  expect(press(INITIAL_WATCH_STATE, ['n', 'return', 'escape']).detail).toBe(false);
  expect(press(INITIAL_WATCH_STATE, ['n', 'return', 'down']).detail).toBe(false);
});

test('d asks for a reason; escape cancels, an empty reason is refused', () => {
  const asking = press(INITIAL_WATCH_STATE, ['n', 'down', 'd']);
  expect(asking.reason).toBe('');
  expect(pressKey(asking, { name: 'escape' }, 3).state.reason).toBeNull();
  const empty = pressKey(asking, { name: 'return' }, 3);
  expect(empty.action).toBeUndefined();
  expect(empty.state.message).toBe('a reason is required');
  let state = asking;
  for (const sequence of 'outdatex') state = pressKey(state, { sequence }, 3).state;
  state = pressKey(state, { name: 'backspace' }, 3).state;
  state = pressKey(state, { sequence: 'd' }, 3).state;
  expect(state.reason).toBe('outdated');
  expect(pressKey(state, { name: 'return' }, 3)).toEqual({
    state: { ...state, reason: null, message: null },
    action: { type: 'drop', index: 1, reason: 'outdated' },
  });
});

test('q and ctrl-c quit, also while typing a reason', () => {
  expect(pressKey(INITIAL_WATCH_STATE, { name: 'q' }, 0).action).toEqual({ type: 'quit' });
  const typing = { ...INITIAL_WATCH_STATE, notesOpen: true, reason: 'q' };
  expect(pressKey(typing, { name: 'q', sequence: 'q' }, 1).action).toBeUndefined();
  expect(pressKey(typing, { name: 'c', ctrl: true }, 1).action).toEqual({ type: 'quit' });
});

function withNotes() {
  const made = makeCarnet();
  const { carnet } = made;
  const first = carnet.notes.add({
    kind: 'dead_end',
    text: 'SSR cache keyed per tenant: too wide, leaks between tenants',
    repos: ['api'],
    session: SESSION,
  });
  const second = carnet.notes.add({
    kind: 'decision',
    text: 'auth stays in session: SSO partners need cookies',
    session: SESSION,
  });
  return { ...made, first: first.note.id, second: second.note.id };
}

test('the unfolded section marks the selected note and shows its detail', () => {
  const { carnet, first } = withNotes();
  const state = { ...INITIAL_WATCH_STATE, notesOpen: true, selected: 1, detail: true };
  const lines = renderStatusView(carnet, makeIo({ columns: 200 }), {
    session: SESSION,
    interaction: state,
  }).split('\n');
  const selected = lines.findIndex((line) => line.startsWith('› '));
  expect(lines[selected]).toContain(`#${first}`);
  expect(lines.slice(selected + 1, selected + 4)).toEqual([
    '    SSR cache keyed per tenant: too wide, leaks between tenants',
    '    repos: api',
    '    active · weight 0.00 · 0 cited',
  ]);
  expect(lines).toContain('n fold · ↑↓ select · enter detail · d drop · q quit');
});

test('the prompt line shows the reason being typed', () => {
  const { carnet, second } = withNotes();
  const state = { ...INITIAL_WATCH_STATE, notesOpen: true, reason: 'outda' };
  const text = renderStatusView(carnet, makeIo(), { session: SESSION, interaction: state });
  expect(text).toContain(`drop #${second}, reason: outda`);
});

function fakeKeys(): KeySource & { press: (key: Key) => void; closed: number } {
  let listener: (key: Key) => void = () => {};
  const source = {
    closed: 0,
    onKey: (onKey: (key: Key) => void) => {
      listener = onKey;
    },
    close: () => {
      source.closed++;
    },
    press: (key: Key) => listener(key),
  };
  return source;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

test('watch keys drop the selected note for the displayed session, then q quits', async () => {
  const { carnet, second } = withNotes();
  const io = makeIo();
  const keys = fakeKeys();
  const done = statusWatch(carnet, io, { session: SESSION, intervalMilliseconds: 5, keys });
  await tick();
  keys.press({ name: 'n' });
  keys.press({ name: 'd' });
  for (const sequence of 'obsolete') keys.press({ sequence });
  keys.press({ name: 'return' });
  expect(carnet.notes.get(second)).toMatchObject({
    droppedReason: 'obsolete',
    droppedSession: SESSION,
  });
  keys.press({ name: 'q' });
  await done;
  expect(keys.closed).toBe(1);
  expect(io.output.at(-1)).toBe('\x1b[?25h');
});

test('typing a reason pauses the refresh', async () => {
  const { carnet } = withNotes();
  const io = makeIo();
  const keys = fakeKeys();
  const controller = new AbortController();
  const done = statusWatch(carnet, io, {
    session: SESSION,
    intervalMilliseconds: 5,
    keys,
    signal: controller.signal,
  });
  keys.press({ name: 'n' });
  keys.press({ name: 'd' });
  const paints = io.output.length;
  carnet.agents.start(SESSION, { name: 'banner', task: 't' });
  await tick();
  expect(io.output.length).toBe(paints);
  keys.press({ name: 'escape' });
  await tick();
  expect(io.output.join('')).toContain('banner');
  controller.abort();
  await done;
});

test('--all --watch only quits on keys', async () => {
  const { carnet } = withNotes();
  const io = makeIo();
  const keys = fakeKeys();
  const done = statusWatch(carnet, io, { all: true, intervalMilliseconds: 5, keys });
  keys.press({ name: 'n' });
  expect(io.output.join('')).not.toContain('n fold');
  keys.press({ name: 'q' });
  await done;
});

class FakeTerminal extends EventEmitter {
  isTTY = true;
  raw: boolean[] = [];
  paused = false;
  setRawMode(mode: boolean) {
    this.raw.push(mode);
  }
  resume() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
}

test('terminal keys need two TTYs and restore the terminal once, also on exit', () => {
  const owner = new EventEmitter();
  expect(terminalKeys(new FakeTerminal(), { isTTY: false }, owner)).toBeUndefined();
  const pipe = Object.assign(new FakeTerminal(), { isTTY: false });
  expect(terminalKeys(pipe, { isTTY: true }, owner)).toBeUndefined();
  const input = new FakeTerminal();
  const keys = terminalKeys(input, { isTTY: true }, owner);
  const seen: Key[] = [];
  keys?.onKey((key) => seen.push(key));
  input.emit('keypress', 'q', { name: 'q', sequence: 'q' });
  expect(seen).toEqual([{ name: 'q', sequence: 'q' }]);
  keys?.close();
  owner.emit('exit');
  expect(input.raw).toEqual([true, false]);
  expect(input.paused).toBe(true);
  const crashed = new FakeTerminal();
  terminalKeys(crashed, { isTTY: true }, owner);
  owner.emit('exit');
  expect(crashed.raw).toEqual([true, false]);
});

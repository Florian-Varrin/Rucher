export interface Key {
  name?: string | undefined;
  sequence?: string | undefined;
  ctrl?: boolean | undefined;
}

export interface WatchState {
  notesOpen: boolean;
  selected: number;
  detail: boolean;
  reason: string | null;
  message: string | null;
}

export type WatchAction = { type: 'quit' } | { type: 'drop'; index: number; reason: string };

export interface KeyResult {
  state: WatchState;
  action?: WatchAction;
}

export const INITIAL_WATCH_STATE: WatchState = {
  notesOpen: false,
  selected: 0,
  detail: false,
  reason: null,
  message: null,
};

function clamp(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(count - 1, 0));
}

function typeReason(state: WatchState, key: Key): KeyResult {
  const reason = state.reason ?? '';
  if (key.name === 'escape') return { state: { ...state, reason: null, message: null } };
  if (key.name === 'return' || key.name === 'enter') {
    const trimmed = reason.trim();
    if (!trimmed) return { state: { ...state, message: 'a reason is required' } };
    return {
      state: { ...state, reason: null, detail: false, message: null },
      action: { type: 'drop', index: state.selected, reason: trimmed },
    };
  }
  if (key.name === 'backspace') return { state: { ...state, reason: reason.slice(0, -1) } };
  const character = key.sequence ?? '';
  if (character.length === 1 && character >= ' ' && !key.ctrl) {
    return { state: { ...state, reason: reason + character, message: null } };
  }
  return { state };
}

export function pressKey(state: WatchState, key: Key, noteCount: number): KeyResult {
  if (key.ctrl && key.name === 'c') return { state, action: { type: 'quit' } };
  if (state.reason !== null) return typeReason(state, key);
  const next = { ...state, message: null };
  switch (key.name) {
    case 'q':
      return { state: next, action: { type: 'quit' } };
    case 'n':
      return {
        state: { ...next, notesOpen: !state.notesOpen && noteCount > 0, detail: false },
      };
    case 'escape':
      return { state: { ...next, detail: false } };
  }
  if (!state.notesOpen || noteCount === 0) return { state: next };
  const selected = clamp(state.selected, noteCount);
  switch (key.name) {
    case 'up':
      return { state: { ...next, selected: clamp(selected - 1, noteCount), detail: false } };
    case 'down':
      return { state: { ...next, selected: clamp(selected + 1, noteCount), detail: false } };
    case 'return':
    case 'enter':
      return { state: { ...next, selected, detail: !state.detail } };
    case 'd':
      return { state: { ...next, selected, detail: false, reason: '' } };
  }
  return { state: { ...next, selected } };
}

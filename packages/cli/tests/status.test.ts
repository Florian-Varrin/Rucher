import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { LEGEND } from '@rucher/carnet';
import { renderStatusView, statusWatch } from '../src/commands/status.ts';
import { CliError } from '../src/session.ts';
import { makeCarnet, makeIo, SESSION } from './helpers.ts';

function seeded() {
  const made = makeCarnet();
  const { carnet } = made;
  carnet.agents.start(SESSION, { name: 'banner', task: 't' });
  carnet.agents.start(SESSION, { name: 'dto', task: 't' });
  carnet.agents.finish(SESSION, 'dto', { reportPath: 'r.md', hasQuestions: true });
  carnet.table.set(SESSION, { text: 'Step 1 — applying', mainWorking: true });
  return made;
}

test('renders the default session as plain text without color', () => {
  const { carnet } = seeded();
  const text = renderStatusView(carnet, makeIo(), {});
  const lines = text.split('\n');
  expect(lines[0]).toMatch(/^\d\d:\d\d$/);
  expect(lines.slice(1)).toEqual([
    '',
    '0360889d · api',
    'On the table',
    '  ⚙️ Step 1 — applying (main working, not ready)',
    '',
    'Waiting on you',
    '  1. ❓ dto',
    '',
    'Running',
    '  ⏳ banner',
    '',
    '⚙️ main working · 💬 discussing · ❓ answer · 👀 review · 📥 apply · 🧪 test · ✅ commit · 🌿 branch · ⏳ running',
  ]);
});

test('colors headers and the main working line when color is on', () => {
  const { carnet } = seeded();
  const text = renderStatusView(carnet, makeIo({ color: true }), {});
  expect(text).toContain('\x1b[1mWaiting on you\x1b[22m');
  expect(text).toContain('\x1b[33m  ⚙️ Step 1 — applying (main working, not ready)\x1b[39m');
});

test('truncates lines to the terminal width', () => {
  const { carnet } = seeded();
  const text = renderStatusView(carnet, makeIo({ columns: 20 }), {});
  const lines = text.split('\n');
  expect(lines.slice(1, -1).every((line) => Array.from(line).length <= 20)).toBe(true);
  expect(text).toContain('  ⚙️ Step 1 — apply…');
  expect(lines.at(-1)).toContain('⏳ running');
});

test('--session accepts a name and rejects unknown refs with the known names', () => {
  const { carnet } = seeded();
  carnet.sessions.name(SESSION, 'banner-work');
  expect(renderStatusView(carnet, makeIo(), { session: 'banner-work' })).toContain('⏳ banner');
  try {
    renderStatusView(carnet, makeIo(), { session: 'nope' });
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).hint).toBe('known sessions: banner-work');
  }
});

test('--all lists sessions with activity under a header, most recent first', () => {
  const { carnet, root } = seeded();
  carnet.sessions.upsertFromHook({ session_id: 'other', cwd: root, session_title: 'other-work' });
  carnet.agents.start('other', { name: 'x', task: 't' });
  carnet.sessions.upsertFromHook({ session_id: 'idle', cwd: root });
  const text = renderStatusView(carnet, makeIo(), { all: true });
  const headers = text
    .split('\n')
    .filter((line) => line.startsWith('other-work') || line.startsWith('0360889d'));
  expect(headers).toEqual(['other-work', '0360889d · api']);
  expect(text).not.toContain('idle');
});

test('--all shows the clock and the legend once, and a header on every block', () => {
  const { carnet, root } = seeded();
  carnet.sessions.upsertFromHook({ session_id: 'other', cwd: root, session_title: 'other-work' });
  carnet.agents.start('other', { name: 'x', task: 't' });
  const lines = renderStatusView(carnet, makeIo(), { all: true }).split('\n');
  expect(lines[0]).toMatch(/^\d\d:\d\d$/);
  expect(lines.filter((line) => /^\d\d:\d\d$/.test(line))).toHaveLength(1);
  expect(lines.filter((line) => line === LEGEND)).toHaveLength(1);
  expect(lines.at(-1)).toBe(LEGEND);
  expect(lines.filter((line) => line === 'Waiting on you')).toHaveLength(2);
  const headers = lines.filter(
    (line, index) =>
      line !== '' && (lines[index + 1] === 'Waiting on you' || lines[index + 1] === 'On the table'),
  );
  expect(headers).toEqual(['other-work', '0360889d · api']);
});

test('watch repaints only on change and stops on abort', async () => {
  const { carnet } = seeded();
  const io = makeIo();
  const controller = new AbortController();
  const done = statusWatch(carnet, io, { intervalMilliseconds: 5, signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const paints = io.output.filter((output) => output.startsWith('\x1b[H\x1b[2J')).length;
  expect(paints).toBe(1);
  carnet.agents.update(SESSION, 'banner', { status: 'running', note: 'moved' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(io.output.filter((output) => output.startsWith('\x1b[H\x1b[2J')).length).toBe(2);
  controller.abort();
  await done;
  expect(io.output.at(-1)).toBe('\x1b[?25h');
});

test('--all headers show the cwd relative to its repo', () => {
  const { carnet, root } = seeded();
  mkdirSync(join(root, 'api', 'src', 'deep'), { recursive: true });
  carnet.sessions.upsertFromHook({
    session_id: SESSION,
    cwd: join(root, 'api', 'src', 'deep'),
    source: 'resume',
  });
  const text = renderStatusView(carnet, makeIo(), { all: true });
  expect(text.split('\n')[2]).toBe('0360889d · api/src/deep');
});

test('the single view names its session and follows the default on every render', () => {
  const { carnet, root } = seeded();
  carnet.sessions.name(SESSION, 'shop-auth');
  expect(renderStatusView(carnet, makeIo(), {}).split('\n')[2]).toBe('shop-auth · api');
  carnet.sessions.upsertFromHook({ session_id: 'later', cwd: root, session_title: 'shop-cart' });
  const text = renderStatusView(carnet, makeIo(), {});
  expect(text.split('\n')[2]).toBe('shop-cart');
  expect(text).not.toContain('banner');
});

test('a dropped --session says so instead of showing stale data', () => {
  const { carnet } = seeded();
  carnet.sessions.name(SESSION, 'shop-auth');
  carnet.sessions.drop(SESSION);
  const lines = renderStatusView(carnet, makeIo(), { session: 'shop-auth' }).split('\n');
  expect(lines.slice(2, 4)).toEqual(['shop-auth · api', '  dropped, see rucher sessions --all']);
});

test('--all --watch picks up a session that starts after the watch', async () => {
  const { carnet, root } = seeded();
  const io = makeIo();
  const controller = new AbortController();
  const done = statusWatch(carnet, io, {
    all: true,
    intervalMilliseconds: 5,
    signal: controller.signal,
  });
  carnet.sessions.upsertFromHook({ session_id: 'later', cwd: root, session_title: 'shop-cart' });
  carnet.agents.start('later', { name: 'cart', task: 't' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  controller.abort();
  await done;
  expect(io.output.join('')).toContain('shop-cart');
});

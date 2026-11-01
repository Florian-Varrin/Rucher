import { expect, test } from 'vite-plus/test';
import { type CarnetError, formatClock, renderStatus, sanitizeNote } from '../src/index.ts';
import { SESSION, withSession } from './helpers.ts';

test('sanitizeNote strips backticks and paths, caps at 60 characters', () => {
  expect(sanitizeNote('keep `the cache` in src/cache.ts and ./tmp')).toBe('keep the cache in and');
  expect(sanitizeNote('Step 11 Preview/Run — applying')).toBe('Step 11 Preview/Run — applying');
  expect(sanitizeNote('see /home/me/x and ~/y and a/b/c')).toBe('see and and');
  const long = sanitizeNote('x'.repeat(80));
  expect(long).toHaveLength(60);
  expect(long.endsWith('…')).toBe(true);
  expect(sanitizeNote('  spaced   out  ')).toBe('spaced out');
});

test('formatClock pads hours and minutes', () => {
  expect(formatClock(new Date(2026, 0, 1, 9, 5))).toBe('09:05');
});

test('waiting order is answer, review, then the rest, unless reordered', () => {
  const { carnet } = withSession();
  carnet.agents.start(SESSION, { name: 'first-review', task: 't' });
  carnet.agents.start(SESSION, { name: 'apply-me', task: 't' });
  carnet.agents.start(SESSION, { name: 'ask', task: 't' });
  carnet.agents.start(SESSION, { name: 'runner', task: 't' });
  carnet.agents.finish(SESSION, 'first-review', { reportPath: 'a.md', hasQuestions: false });
  carnet.agents.update(SESSION, 'apply-me', { status: 'apply' });
  carnet.agents.finish(SESSION, 'ask', { reportPath: 'b.md', hasQuestions: true });

  const session = carnet.sessions.require(SESSION);
  const view = carnet.status.view(session);
  expect(view.waiting.map((line) => line.name)).toEqual(['ask', 'first-review', 'apply-me']);
  expect(view.running.map((line) => line.name)).toEqual(['runner']);

  carnet.agents.reorderQueue(SESSION, ['apply-me', 'ask']);
  expect(carnet.status.view(session).waiting.map((line) => line.name)).toEqual([
    'apply-me',
    'ask',
    'first-review',
  ]);
});

test('table line refuses a status while main is working', () => {
  const { carnet } = withSession();
  let code: string | undefined;
  try {
    carnet.table.set(SESSION, { text: 'Step 1', mainWorking: true, status: 'review' });
  } catch (error) {
    code = (error as CarnetError).code;
  }
  expect(code).toBe('TABLE_STATUS_WITH_MAIN_WORKING');
  expect(
    carnet.table.set(SESSION, { text: 'Step 1 — `x`', mainWorking: false, status: 'review' }),
  ).toMatchObject({
    text: 'Step 1 — x',
    status: 'review',
    mainWorking: false,
  });
  carnet.table.clear(SESSION);
  expect(carnet.table.get(SESSION)).toBeUndefined();
});

test('renderStatus matches the spec format', () => {
  const { carnet } = withSession();
  carnet.agents.start(SESSION, { name: 'setParent fix (develop)', task: 't' });
  carnet.agents.start(SESSION, { name: 'Step 13', task: 't' });
  carnet.agents.finish(SESSION, 'setParent fix (develop)', {
    reportPath: 'r.md',
    hasQuestions: false,
  });
  carnet.agents.update(SESSION, 'setParent fix (develop)', {
    status: 'review',
    note: 'review, name branch',
  });
  carnet.agents.update(SESSION, 'Step 13', { status: 'running', note: 'bricks moved to sidebar' });
  carnet.table.set(SESSION, { text: 'Step 11 Preview/Run — applying', mainWorking: true });

  const view = { ...carnet.status.view(carnet.sessions.require(SESSION)), time: '16:41' };
  expect(renderStatus(view)).toBe(
    [
      '16:41',
      '',
      'On the table',
      '  ⚙️ Step 11 Preview/Run — applying (main working, not ready)',
      '',
      'Waiting on you',
      '  1. 👀 setParent fix (develop) — review, name branch',
      '',
      'Running',
      '  ⏳ Step 13 — bricks moved to sidebar',
      '',
      '⚙️ main working · 💬 discussing · ❓ answer · 👀 review · 📥 apply · 🧪 test · ✅ commit · 🌿 branch · ⏳ running',
    ].join('\n'),
  );
});

test('renderStatus without table and with empty sections', () => {
  const { carnet } = withSession();
  const view = { ...carnet.status.view(carnet.sessions.require(SESSION)), time: '09:00' };
  expect(renderStatus(view)).toContain('Waiting on you\n  nothing\n\nRunning\n  nothing\n');
  expect(renderStatus(view)).not.toContain('On the table');
});

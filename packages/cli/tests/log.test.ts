import { expect, test } from 'vite-plus/test';
import { formatEvents, formatEventsMarkdown, logOnce } from '../src/commands/log.ts';
import { makeCarnet, makeIo, SESSION } from './helpers.ts';

test('formats events with time, type, agent, link and short commit', () => {
  const { carnet } = makeCarnet();
  carnet.agents.start(SESSION, { name: 'banner', task: 'Add banner' });
  carnet.events.log(SESSION, { type: 'committed', agent: 'banner', commit: 'abcdef1234567' });
  const text = formatEvents(carnet.events.read(SESSION), makeIo());
  const lines = text.split('\n');
  expect(lines[0]).toMatch(/^\d\d:\d\d  started    banner  Add banner$/);
  expect(lines[1]).toMatch(/^\d\d:\d\d  committed  banner  abcdef1$/);
});

test('logOnce honours the count and reports an empty journal', () => {
  const { carnet } = makeCarnet();
  for (let index = 0; index < 3; index++)
    carnet.events.log(SESSION, { type: 'tested', note: `n${index}` });
  const io = makeIo();
  logOnce(carnet, io, { count: 2 });
  expect(io.output.join('')).toMatch(/n1\n.*n2\n$/);
  const empty = makeCarnet();
  const io2 = makeIo();
  logOnce(empty.carnet, io2, { count: 5 });
  expect(io2.output.join('')).toBe('no events yet\n');
});

test('logOnce shows events by time, not by insertion order', () => {
  const { carnet } = makeCarnet();
  carnet.events.log(SESSION, { type: 'tested', note: 'recent' });
  carnet.db
    .prepare("INSERT INTO events (session, at, type, note) VALUES (?, ?, 'tested', 'moved')")
    .run(SESSION, '2026-10-30T09:00:00.000Z');
  const io = makeIo();
  logOnce(carnet, io, { count: 5 });
  expect(io.output.join('')).toMatch(/moved\n.*recent\n$/);
});

test('--md renders the journal as markdown grouped by day', () => {
  const { carnet } = makeCarnet();
  carnet.agents.start(SESSION, { name: 'banner', task: 'Add banner' });
  carnet.agents.finish(SESSION, 'banner', { reportPath: '/r/banner.md', hasQuestions: false });
  carnet.events.log(SESSION, { type: 'committed', agent: 'banner', commit: 'abcdef1234567' });
  const lines = formatEventsMarkdown(carnet.events.read(SESSION), 'shop · main').split('\n');
  expect(lines[0]).toBe('# Journal: shop · main');
  expect(lines[2]).toMatch(/^## \d{4}-\d\d-\d\d$/);
  expect(lines.slice(4)).toEqual([
    expect.stringMatching(/^- \d\d:\d\d \*\*started\*\* `banner`: Add banner$/),
    expect.stringMatching(/^- \d\d:\d\d \*\*finished\*\* `banner`: \[report\]\(\/r\/banner\.md\)$/),
    expect.stringMatching(/^- \d\d:\d\d \*\*committed\*\* `banner`: `abcdef1`$/),
  ]);
  const io = makeIo();
  logOnce(carnet, io, { count: 20, md: true });
  expect(io.output.join('')).toMatch(/^# Journal: test-group · 0360889d\n/);
  expect(formatEventsMarkdown([], 'x')).toBe('# Journal: x\n\nNo events yet.');
});

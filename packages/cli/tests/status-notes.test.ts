import { expect, test } from 'vite-plus/test';
import { renderStatusView } from '../src/commands/status.ts';
import { makeCarnet, makeIo, SESSION } from './helpers.ts';

const OTHER = 'a1b2c3d4-0000-4000-8000-000000000002';

function notesSection(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith('Notes'));
  if (start === -1) return [];
  const end = lines.indexOf('', start);
  return lines.slice(start, end === -1 ? undefined : end);
}

function withNotes() {
  const made = makeCarnet();
  const { carnet } = made;
  carnet.sessions.ensure(OTHER);
  const decision = carnet.notes.add({
    kind: 'decision',
    text: 'auth stays in session: SSO partners need cookies',
    session: OTHER,
  });
  const leak = carnet.notes.add({
    kind: 'dead_end',
    text: 'SSR cache keyed per tenant: too wide, leaks between tenants',
    session: SESSION,
  });
  return { ...made, decision: decision.note.id, leak: leak.note.id };
}

test('no Notes section when the session touched no note', () => {
  const { carnet } = makeCarnet();
  expect(notesSection(renderStatusView(carnet, makeIo(), { session: SESSION }))).toEqual([]);
});

test('lists notes added, cited and dropped in the session, most recent first, under Running', () => {
  const { carnet, decision, leak } = withNotes();
  carnet.notes.cite(decision, { why: 'kept the cookie session', session: SESSION });
  const reworded = carnet.notes.add({
    kind: 'dead_end',
    text: 'SSR cache keyed per tenant: too wide, leaks across tenants',
    session: SESSION,
  });
  carnet.notes.drop(leak, {
    reason: 'reworded',
    replacedBy: reworded.note.id,
    session: SESSION,
  });
  const text = renderStatusView(carnet, makeIo({ columns: 200 }), { session: SESSION });
  expect(notesSection(text)).toEqual([
    'Notes',
    `  − #${leak}  dropped   replaced by #${reworded.note.id}`,
    `  + #${reworded.note.id}  dead_end  SSR cache keyed per tenant: too wide, leaks across tenants`,
    `  ★ #${decision}  cited     kept the cookie session`,
    `  + #${leak}  dead_end  SSR cache keyed per tenant: too wide, leaks between tenants`,
  ]);
  const lines = text.split('\n');
  expect(lines.indexOf('Notes')).toBeGreaterThan(lines.indexOf('Running'));
});

test('a drop without replacement shows its reason', () => {
  const { carnet, leak } = withNotes();
  carnet.notes.drop(leak, { reason: 'the cache moved to the edge', session: SESSION });
  expect(notesSection(renderStatusView(carnet, makeIo(), { session: SESSION }))[1]).toBe(
    `  − #${leak}  dropped   the cache moved to the edge`,
  );
});

test('folds to one summary line beyond five lines, counting possible duplicates', () => {
  const { carnet } = withNotes();
  const texts = [
    'tests need REDIS_URL even for unit tests',
    'tests need REDIS_URL even for the unit tests',
    'the tenant header must be forwarded end to end',
    'deploys go through the staging branch first',
    'feature flags live in the admin service',
  ];
  for (const text of texts) carnet.notes.add({ kind: 'learning', text, session: SESSION });
  expect(notesSection(renderStatusView(carnet, makeIo(), { session: SESSION }))).toEqual([
    'Notes  6 added · 1 possible duplicate',
  ]);
});

test('--all shows only the summary line, and lists sessions with note activity only', () => {
  const { carnet, decision } = withNotes();
  carnet.notes.cite(decision, { why: 'kept the cookie session', session: SESSION });
  const text = renderStatusView(carnet, makeIo(), { all: true });
  expect(text).toContain('Notes  1 added · 1 cited');
  expect(text).toContain('Notes  1 added');
  expect(text).not.toContain('  + #');
  expect(text.split('\n').filter((line) => line.startsWith('Notes'))).toHaveLength(2);
});

test('narrow terminals cut note lines but keep the Notes header', () => {
  const { carnet } = withNotes();
  const section = notesSection(
    renderStatusView(carnet, makeIo({ columns: 30 }), { session: SESSION }),
  );
  expect(section[0]).toBe('Notes');
  expect(section[1]).toHaveLength(30);
  expect(section[1]?.endsWith('…')).toBe(true);
});

test('keeps the duplicate warning visible on a narrow terminal and colors it', () => {
  const { carnet, leak } = withNotes();
  carnet.notes.add({
    kind: 'dead_end',
    text: 'SSR cache keyed per tenant: too wide, leaks across tenants',
    session: SESSION,
  });
  const text = renderStatusView(carnet, makeIo({ color: true }), { session: SESSION });
  expect(text).toContain(`\x1b[33msimilar to #${leak} ·\x1b[39m`);
});

test('a narrow terminal cuts the note text, not the duplicate warning', () => {
  const { carnet, leak } = withNotes();
  carnet.notes.add({
    kind: 'dead_end',
    text: 'SSR cache keyed per tenant: too wide, leaks across tenants',
    session: SESSION,
  });
  const line = notesSection(
    renderStatusView(carnet, makeIo({ columns: 40 }), { session: SESSION }),
  )[1];
  expect(line).toBe(`  + #3  dead_end  similar to #${leak} · SSR c…`);
});

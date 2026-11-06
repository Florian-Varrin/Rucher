import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Carnet, MEMORY_DB, openDatabase } from '@rucher/carnet';
import { expect, test } from 'vite-plus/test';
import {
  notesAdd,
  notesDrop,
  notesList,
  notesShow,
  parseNoteId,
  repoList,
} from '../src/commands/notes.ts';
import { makeClock, makeIo, SESSION, tempDirectory, workspaceAt } from './helpers.ts';

function shop() {
  const root = tempDirectory();
  for (const repo of ['shop-api', 'shop-web']) mkdirSync(join(root, repo));
  const workspace = workspaceAt(root, 'shop', [join(root, 'shop-api'), join(root, 'shop-web')]);
  const carnet = new Carnet(openDatabase(MEMORY_DB), workspace, { now: makeClock() });
  carnet.sessions.upsertFromHook({ session_id: SESSION, cwd: root, source: 'startup' });
  carnet.sessions.name(SESSION, 'shop-auth');
  return carnet;
}

test('notes list without a workspace hints on stderr, not an empty list', () => {
  const io = makeIo();
  notesList(new Carnet(openDatabase(MEMORY_DB), null), io);
  expect(io.output).toEqual([]);
  expect(io.errors).toEqual(['no workspace here: pass --ws\n']);
});

test('repeated or comma-separated --repo flags are all kept', () => {
  expect(repoList(['dead_end', 'x', '--repo', 'shop-api', '--repo=shop-web,shop-api'])).toEqual([
    'shop-api',
    'shop-web',
    'shop-api',
  ]);
  expect(parseNoteId('#14')).toBe(14);
  expect(() => parseNoteId('abc')).toThrowError(/Invalid note id/);
});

test('notes add warns about a near duplicate, list workspaces by kind with the warning', () => {
  const carnet = shop();
  notesAdd(carnet, makeIo(), {
    kind: 'dead_end',
    text: 'sessions on Workers: the cold start breaks the SSR cache',
    repos: ['shop-api'],
  });
  const io = makeIo();
  notesAdd(carnet, io, {
    kind: 'dead_end',
    text: 'sessions on Workers: cold start breaks the SSR cache',
    repos: [],
  });
  expect(io.output.join('')).toBe(
    'added #2 dead_end sessions on Workers: cold start breaks the SSR cache\n' +
      'similar active notes, possible duplicate:\n' +
      '  #1 [shop-api] sessions on Workers: the cold start breaks the SSR cache\n',
  );
  notesAdd(carnet, makeIo(), { kind: 'learning', text: 'the build needs Node 24', repos: [] });
  const listed = makeIo();
  notesList(carnet, listed);
  expect(listed.output.join('')).toBe(
    'Dead ends\n' +
      '  #2    sessions on Workers: cold start breaks the SSR cache  · similar to #1\n' +
      '  #1    [shop-api] sessions on Workers: the cold start breaks the SSR cache\n\n' +
      'Learnings\n' +
      '  #3    the build needs Node 24\n',
  );
  const general = makeIo();
  notesList(carnet, general, { general: true, kind: 'learning' });
  expect(general.output.join('')).toBe('Learnings\n  #3    the build needs Node 24\n');
});

test('notes drop, show and markdown export', () => {
  const carnet = shop();
  notesAdd(carnet, makeIo(), { kind: 'learning', text: 'the cache key is per user', repos: [] });
  notesAdd(carnet, makeIo(), {
    kind: 'learning',
    text: 'the cache key is per tenant',
    repos: ['shop-web'],
  });
  carnet.notes.cite(2, { why: 'keyed the cache by tenant', session: SESSION, agent: 'banner' });
  const dropped = makeIo();
  notesDrop(carnet, dropped, 1, { reason: 'the key is per tenant', replacedBy: 2 });
  expect(dropped.output.join('')).toBe('dropped #1, replaced by #2\n');
  const shown = makeIo();
  notesShow(carnet, shown, 2);
  const lines = shown.output.join('').split('\n');
  expect(lines[0]).toBe('#2 learning');
  expect(lines[2]).toBe('repos: shop-web');
  expect(lines[4]).toBe('weight: 1.00 · 1 citation');
  expect(lines[5]).toBe('similar to: #1');
  expect(lines[7]).toMatch(/shop-auth {2}banner {2}keyed the cache by tenant$/);
  const old = makeIo();
  notesShow(carnet, old, 1);
  expect(old.output.join('')).toContain('dropped: ');
  expect(old.output.join('')).toContain('the key is per tenant, replaced by #2');
  const exported = makeIo();
  notesList(carnet, exported, { all: true, markdown: true });
  expect(exported.output.join('')).toBe(
    '# Memory: shop\n\n## Learnings\n\n' +
      '- #2 [shop-web] the cache key is per tenant\n' +
      '- #1 the cache key is per user (dropped: the key is per tenant)\n',
  );
  const empty = makeIo();
  notesList(carnet, empty, { stale: true });
  expect(empty.output.join('')).toBe('no note to review\n');
});

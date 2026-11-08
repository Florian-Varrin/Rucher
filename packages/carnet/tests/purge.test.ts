import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import {
  Carnet,
  DEFAULT_PURGE_DAYS,
  handleSessionStart,
  MEMORY_DB,
  openDatabase,
  purgeDays,
} from '../src/index.ts';
import { tempDirectory, workspaceAt } from './helpers.ts';

const DAY = 24 * 60 * 60 * 1000;

function clockedCarnet() {
  const root = tempDirectory();
  const workspace = workspaceAt(root, 'shop', [join(root, 'api')]);
  let time = Date.parse('2026-10-20T09:00:00.000Z');
  const carnet = new Carnet(openDatabase(MEMORY_DB), workspace, { now: () => new Date(time) });
  return {
    carnet,
    root,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
  };
}

function ids(carnet: Carnet): string[] {
  return carnet.sessions
    .list({ includeTemp: true, includeArchived: true })
    .map((session) => session.id)
    .sort();
}

test('purges idle empty temporary and dropped sessions, keeps the rest', () => {
  const { carnet, advance } = clockedCarnet();
  carnet.sessions.ensure('empty-temporary');
  carnet.sessions.ensure('temporary-with-agent');
  carnet.agents.start('temporary-with-agent', { name: 'banner', task: 't' });
  carnet.sessions.ensure('temporary-with-event');
  carnet.events.log('temporary-with-event', { type: 'tested' });
  carnet.sessions.ensure('empty-dropped');
  carnet.table.set('empty-dropped', { text: 'leftover', mainWorking: false });
  carnet.sessions.drop('empty-dropped');
  carnet.sessions.ensure('dropped-with-history');
  carnet.agents.start('dropped-with-history', { name: 'old', task: 't' });
  carnet.sessions.drop('dropped-with-history');
  carnet.sessions.ensure('named');
  carnet.sessions.name('named', 'shop-auth');
  carnet.sessions.ensure('current');

  advance(DEFAULT_PURGE_DAYS * DAY + 1);
  carnet.sessions.ensure('fresh');
  const purged = carnet.sessions.purge('current', DEFAULT_PURGE_DAYS);

  expect(purged.sort()).toEqual(['empty-dropped', 'empty-temporary']);
  expect(ids(carnet)).toEqual([
    'current',
    'dropped-with-history',
    'fresh',
    'named',
    'temporary-with-agent',
    'temporary-with-event',
  ]);
  expect(carnet.table.get('empty-dropped')).toBeUndefined();
});

test('sessions idle for exactly the delay are kept', () => {
  const { carnet, advance } = clockedCarnet();
  carnet.sessions.ensure('boundary');
  advance(2 * DAY);
  expect(carnet.sessions.purge('current', 2)).toEqual([]);
  advance(1);
  expect(carnet.sessions.purge('current', 2)).toEqual(['boundary']);
});

test('purge days come from the environment, invalid values fall back to the default', () => {
  expect(purgeDays(undefined)).toBe(DEFAULT_PURGE_DAYS);
  expect(purgeDays('7')).toBe(7);
  expect(purgeDays('0.5')).toBe(0.5);
  for (const invalid of ['0', '-2', 'soon', ''])
    expect(purgeDays(invalid)).toBe(DEFAULT_PURGE_DAYS);
});

test('the session start hook purges, never the session it records', () => {
  const { carnet, root, advance } = clockedCarnet();
  carnet.sessions.ensure('old');
  carnet.sessions.ensure('resumed');
  advance(10 * DAY);
  handleSessionStart(carnet, { session_id: 'resumed', cwd: root, source: 'resume' }, {});
  expect(ids(carnet)).toEqual(['resumed']);

  carnet.sessions.ensure('recent');
  advance(DAY);
  handleSessionStart(carnet, { session_id: 'new', cwd: root }, { RUCHER_PURGE_DAYS: '0.5' });
  expect(ids(carnet)).toEqual(['new']);
});

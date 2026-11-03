import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import {
  Carnet,
  claudeCode,
  handleSessionStart,
  handleToolUse,
  handleUserPromptSubmit,
  MEMORY_DB,
  memoryMaxCharacters,
  openDatabase,
} from '../src/index.ts';
import { tempDirectory } from './helpers.ts';

const SESSION = '0360889d-99c7-4c8f-8447-50ce30696e5a';
const FORK = '9f2c6a10-0000-4000-8000-000000000002';

function shop() {
  const root = tempDirectory();
  const api = join(root, 'shop-api');
  const web = join(root, 'shop-web');
  for (const repo of [api, web]) mkdirSync(join(repo, 'src'), { recursive: true });
  const group = {
    root,
    name: 'shop',
    repos: [api, web],
    hosts: ['claude-code'],
    dbPath: MEMORY_DB,
  };
  const db = openDatabase(MEMORY_DB);
  const carnet = new Carnet(group, db, { now: () => new Date('2026-11-03T09:00:00') });
  return { carnet, db, root, api, web };
}

function seed(carnet: Carnet) {
  const general = carnet.notes.add({
    kind: 'decision',
    text: 'auth stays cookie based: partners need cookies',
  });
  const api = carnet.notes.add({
    kind: 'learning',
    text: 'tests need REDIS_URL, even the unit tests',
    repos: ['shop-api'],
  });
  const web = carnet.notes.add({
    kind: 'dead_end',
    text: 'SSR cache per tenant: key too wide, leaks across tenants',
    repos: ['shop-web'],
  });
  return { general: general.note.id, api: api.note.id, web: web.note.id };
}

function start(carnet: Carnet, cwd: string, source: string, session = SESSION) {
  return handleSessionStart(
    carnet,
    { session_id: session, cwd, source },
    { RUCHER_SESSION_ID: session },
  );
}

function toolUse(carnet: Carnet, input: Record<string, unknown>) {
  const payload = claudeCode.parseToolPayload(JSON.stringify({ session_id: SESSION, ...input }));
  return handleToolUse(carnet, payload, {});
}

test('startup brings the general notes and the notes of the session repo', () => {
  const { carnet, api } = shop();
  const ids = seed(carnet);
  const text = start(carnet, join(api, 'src'), 'startup').additionalContext ?? '';
  expect(text).toContain('Rucher memory of the shop group (2 notes, note_list for details):');
  expect(text).toContain(`#${ids.general}`);
  expect(text).toContain(`[shop-api] tests need REDIS_URL`);
  expect(text).not.toContain('SSR cache');
  expect(text.indexOf('Decisions')).toBeLessThan(text.indexOf('Learnings'));
});

test('from the meta directory only the general notes come at startup', () => {
  const { carnet, root } = shop();
  seed(carnet);
  const text = start(carnet, root, 'startup').additionalContext ?? '';
  expect(text).toContain('(1 note, note_list for details)');
  expect(text).not.toContain('[shop-');
});

test('a repo touched by a tool brings its notes once per session', () => {
  const { carnet, root, web } = shop();
  seed(carnet);
  start(carnet, root, 'startup');
  const first = toolUse(carnet, {
    cwd: root,
    tool_name: 'Read',
    tool_input: { file_path: join(web, 'src', 'page.ts') },
  });
  expect(first).toContain('Rucher memory, repo shop-web (1 note, note_list for details):');
  expect(first).toContain('Dead ends');
  expect(
    toolUse(carnet, { cwd: root, tool_name: 'Grep', tool_input: { pattern: 'x', path: web } }),
  ).toBeUndefined();
});

test('each tool points at a path: file_path, path, else the cwd', () => {
  const { carnet, root, api, web } = shop();
  seed(carnet);
  start(carnet, root, 'startup');
  expect(toolUse(carnet, { cwd: api, tool_name: 'Bash', tool_input: { command: 'ls' } })).toContain(
    'repo shop-api',
  );
  expect(
    toolUse(carnet, { cwd: root, tool_name: 'Glob', tool_input: { pattern: '*.ts', path: web } }),
  ).toContain('repo shop-web');
  const payload = (tool: string, input: Record<string, unknown>) =>
    claudeCode.parseToolPayload(
      JSON.stringify({ session_id: SESSION, cwd: root, tool_name: tool, tool_input: input }),
    ).path;
  expect(payload('Edit', { file_path: '/x/a.ts' })).toBe('/x/a.ts');
  expect(payload('Write', { file_path: '/x/b.ts' })).toBe('/x/b.ts');
  expect(payload('Grep', { pattern: 'x' })).toBe(root);
  expect(payload('Bash', { command: 'cd /x && ls' })).toBe(root);
  expect(payload('WebFetch', { url: 'https://example.com' })).toBeUndefined();
});

test('nothing to inject: outside the repos, no notes, a subagent, a repo already in', () => {
  const { carnet, root, api } = shop();
  expect(
    toolUse(carnet, { cwd: root, tool_name: 'Read', tool_input: { file_path: join(api, 'a.ts') } }),
  ).toBeUndefined();
  seed(carnet);
  expect(
    toolUse(carnet, {
      cwd: root,
      tool_name: 'Read',
      tool_input: { file_path: join(root, 'a.md') },
    }),
  ).toBeUndefined();
  expect(
    toolUse(carnet, {
      cwd: root,
      agent_id: 'a1b2',
      tool_name: 'Read',
      tool_input: { file_path: join(api, 'a.ts') },
    }),
  ).toBeUndefined();
  start(carnet, join(api, 'src'), 'startup');
  expect(
    toolUse(carnet, { cwd: root, tool_name: 'Read', tool_input: { file_path: join(api, 'a.ts') } }),
  ).toBeUndefined();
});

test('a note shared with a repo already injected is not repeated', () => {
  const { carnet, root, api, web } = shop();
  carnet.notes.add({
    kind: 'learning',
    text: 'the X-Tenant header must flow end to end',
    repos: ['shop-api', 'shop-web'],
  });
  start(carnet, root, 'startup');
  expect(
    toolUse(carnet, { cwd: root, tool_name: 'Read', tool_input: { file_path: join(api, 'a.ts') } }),
  ).toContain('X-Tenant');
  expect(
    toolUse(carnet, { cwd: root, tool_name: 'Read', tool_input: { file_path: join(web, 'a.ts') } }),
  ).toBeUndefined();
});

test('resume and compact bring back the notes already entered, after the resume context', () => {
  const { carnet, root, web } = shop();
  seed(carnet);
  start(carnet, root, 'startup');
  toolUse(carnet, { cwd: root, tool_name: 'Read', tool_input: { file_path: join(web, 'a.ts') } });
  const resumed = start(carnet, root, 'resume');
  expect(resumed.contextParts).toHaveLength(2);
  expect(resumed.contextParts[0]).toContain('state when resumed');
  expect(resumed.contextParts[1]).toContain('(2 notes');
  expect(resumed.contextParts[1]).toContain('SSR cache');
  expect(resumed.contextParts[1]).not.toContain('REDIS_URL');
  const compacted = start(carnet, root, 'compact');
  expect(compacted.contextParts).toContain(resumed.contextParts[1]);
  expect(compacted.contextParts.join('\n')).not.toContain('state when resumed');
});

test('a fork gets no memory part but keeps its parent repos for later', () => {
  const { carnet, root, web } = shop();
  seed(carnet);
  start(carnet, root, 'startup');
  toolUse(carnet, { cwd: root, tool_name: 'Read', tool_input: { file_path: join(web, 'a.ts') } });
  const fork = handleSessionStart(
    carnet,
    { session_id: FORK, cwd: root, source: 'fork' },
    { RUCHER_SESSION_ID: SESSION },
  );
  expect(fork.contextParts.join('\n')).not.toContain('Rucher memory');
  const compacted = handleSessionStart(
    carnet,
    { session_id: FORK, cwd: root, source: 'compact' },
    { RUCHER_SESSION_ID: SESSION },
  );
  expect(compacted.contextParts.join('\n')).toContain('SSR cache');
});

test('the budget cuts learnings first, lowest weight first, and says how many', () => {
  const { carnet, root } = shop();
  start(carnet, root, 'startup');
  const deadEnd = carnet.notes.add({
    kind: 'dead_end',
    text: 'sessions on Workers: the cold start breaks the SSR cache',
  });
  const kept = carnet.notes.add({
    kind: 'learning',
    text: 'the queue retries failed jobs three times before alerting',
  });
  const cut = carnet.notes.add({
    kind: 'learning',
    text: 'logs rotate daily and keep two weeks of history on disk',
  });
  carnet.notes.cite(kept.note.id, { why: 'checked retries before adding one', session: SESSION });
  const full = start(carnet, root, 'startup').additionalContext ?? '';
  const small =
    handleSessionStart(
      carnet,
      { session_id: SESSION, cwd: root, source: 'clear' },
      { RUCHER_SESSION_ID: SESSION, RUCHER_MEMORY_MAX_CHARACTERS: String(full.length - 20) },
    ).additionalContext ?? '';
  expect(small.length).toBeLessThanOrEqual(full.length - 20);
  expect(small).toContain('(3 notes, 1 left out, note_list for the rest)');
  expect(small).toContain(`#${deadEnd.note.id}`);
  expect(small).toContain(`#${kept.note.id}`);
  expect(small).not.toContain(`#${cut.note.id}`);
});

test('memory budget falls back to 2000 characters', () => {
  expect(memoryMaxCharacters(undefined)).toBe(2000);
  expect(memoryMaxCharacters('0')).toBe(2000);
  expect(memoryMaxCharacters('500')).toBe(500);
});

test('every prompt marks the day as active once', () => {
  const { carnet, db, root } = shop();
  const prompt = { session_id: SESSION, cwd: root };
  handleUserPromptSubmit(carnet, claudeCode, prompt);
  handleUserPromptSubmit(carnet, claudeCode, prompt);
  expect(db.prepare('SELECT day FROM active_days').all()).toEqual([{ day: '2026-11-03' }]);
});

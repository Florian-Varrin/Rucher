import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import {
  appendPromptFile,
  assemblePrompt,
  baseRules,
  CORE_RULES,
  handleSessionStart,
  OUTSIDE_RUCHER_CONTEXT,
  OUTSIDE_RUCHER_NOTICE,
  RULES_UPDATED_NOTICE,
  rulesVersion,
} from '../src/index.ts';
import { makeCarnet, SESSION, tempDirectory } from './helpers.ts';

function setup() {
  const { carnet, root } = makeCarnet();
  const env = { RUCHER_HOME: tempDirectory('home-') };
  return { carnet, root, env, group: carnet.group };
}

function writeGroupPrompt(root: string, text: string): void {
  mkdirSync(join(root, '.rucher'), { recursive: true });
  writeFileSync(join(root, '.rucher', 'prompt.md'), text);
}

test('the base rules are the core rules unless RUCHER_HOME/prompt.md replaces them', () => {
  const { env } = setup();
  expect(baseRules(env)).toBe(CORE_RULES);
  writeFileSync(join(env.RUCHER_HOME, 'prompt.md'), '- my own rules\n');
  expect(baseRules(env)).toBe('- my own rules');
});

test('the prompt puts base rules, group rules then the session identity', () => {
  const { root, env, group } = setup();
  writeGroupPrompt(root, '- shop-api tests need REDIS_URL\n');
  const { text } = assemblePrompt(group, { id: SESSION, name: 'shop-auth', kind: 'active' }, env);
  const base = text.indexOf(CORE_RULES);
  const extra = text.indexOf('shop-api tests need REDIS_URL');
  const identity = text.indexOf(
    'This is the Rucher session shop-auth (active) of the test-group group.',
  );
  expect(base).toBeGreaterThan(-1);
  expect(extra).toBeGreaterThan(base);
  expect(identity).toBeGreaterThan(extra);
  const unnamed = assemblePrompt(group, { id: SESSION, name: null, kind: 'temp' }, env);
  expect(unnamed.text).toContain('session 0360889d (temp)');
});

test('the version follows the rules, not the session identity', () => {
  const { root, env, group } = setup();
  const named = assemblePrompt(group, { id: SESSION, name: 'a', kind: 'active' }, env);
  const renamed = assemblePrompt(group, { id: SESSION, name: 'b', kind: 'temp' }, env);
  expect(named.version).toMatch(/^[0-9a-f]{12}$/);
  expect(renamed.version).toBe(named.version);
  writeGroupPrompt(root, '- one more rule\n');
  expect(rulesVersion(group, env)).not.toBe(named.version);
});

test('the append file is written per session in the group directory', () => {
  const { root, env, group } = setup();
  const { path, version } = appendPromptFile(
    group,
    { id: SESSION, name: 'x', kind: 'active' },
    env,
  );
  expect(path).toBe(join(root, '.rucher', 'prompts', `${SESSION}.md`));
  expect(readFileSync(path, 'utf8')).toBe(
    assemblePrompt(group, { id: SESSION, name: 'x', kind: 'active' }, env).text,
  );
  expect(version).toBe(rulesVersion(group, env));
});

function start(source: string, env: Record<string, string>) {
  const { carnet, root, env: home } = setup();
  const run = (next: string, extra: Record<string, string> = env) =>
    handleSessionStart(
      carnet,
      { session_id: SESSION, cwd: root, source: next },
      { ...home, ...extra },
    );
  return { carnet, home, run, first: run(source) };
}

test('a session started by rucher records its version and gets no warning', () => {
  const { carnet, home, run } = start('clear', { RUCHER_SESSION_ID: SESSION });
  const current = rulesVersion(carnet.group, home);
  const launched = run('startup', { RUCHER_SESSION_ID: SESSION, RUCHER_PROMPT_VERSION: current });
  expect(launched.session.promptVersion).toBe(current);
  expect(launched.notices).toEqual([]);
  expect(launched.additionalContext).toBeUndefined();
});

test('a session never started by rucher is warned once in context and on stderr', () => {
  const { first } = start('startup', {});
  expect(first.additionalContext).toBe(OUTSIDE_RUCHER_CONTEXT);
  expect(first.notices).toEqual([OUTSIDE_RUCHER_NOTICE]);
});

test('a resume keeps the recorded version and tells when the rules changed since', () => {
  const { run, carnet, home } = start('startup', {
    RUCHER_SESSION_ID: SESSION,
    RUCHER_PROMPT_VERSION: 'oldversion00',
  });
  const resumed = run('resume', {});
  expect(resumed.session.promptVersion).toBe('oldversion00');
  expect(resumed.contextParts[0]).toContain('state when resumed');
  expect(resumed.additionalContext).not.toContain(OUTSIDE_RUCHER_CONTEXT);
  expect(resumed.notices).toEqual([RULES_UPDATED_NOTICE]);
  const current = rulesVersion(carnet.group, home);
  const relaunched = run('startup', { RUCHER_SESSION_ID: SESSION, RUCHER_PROMPT_VERSION: current });
  expect(relaunched.notices).toEqual([]);
});

test('a compaction without the append re-injects the rules and clears the version', () => {
  const version = 'oldversion00';
  const { run } = start('startup', { RUCHER_SESSION_ID: SESSION, RUCHER_PROMPT_VERSION: version });
  const compacted = run('compact', {});
  expect(compacted.additionalContext).toContain('was just compacted');
  expect(compacted.additionalContext).toContain(CORE_RULES);
  expect(compacted.session.promptVersion).toBeNull();
  expect(compacted.notices).toEqual([]);
});

test('a compaction or a fork launched by rucher records the version in effect', () => {
  const { run, carnet, home } = start('startup', {});
  const current = rulesVersion(carnet.group, home);
  const launched = { RUCHER_SESSION_ID: SESSION, RUCHER_PROMPT_VERSION: current };
  const compacted = run('compact', launched);
  expect(compacted.session.promptVersion).toBe(current);
  expect(compacted.additionalContext).toBeUndefined();
  expect(run('fork', launched).session.promptVersion).toBe(current);
});

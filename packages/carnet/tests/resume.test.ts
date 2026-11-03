import { expect, test } from 'vite-plus/test';
import { handleSessionStart, resumeContext, rulesVersion } from '../src/index.ts';
import { SESSION, withSession } from './helpers.ts';

test('resume context keeps the status and drops the oldest events to fit', () => {
  const { carnet } = withSession();
  for (let index = 0; index < 30; index++)
    carnet.events.log(SESSION, { type: 'tested', note: `step ${index}` });
  const session = carnet.sessions.require(SESSION);
  const full = resumeContext(carnet, session);
  expect(full).toContain('Waiting on you');
  expect(full).not.toContain('step 9\n');
  expect(full).toContain('step 10');
  expect(full.endsWith('step 29')).toBe(true);

  const small = resumeContext(carnet, session, { maxCharacters: 400 });
  expect(small.length).toBeLessThanOrEqual(400);
  expect(small).toContain('Waiting on you');
  expect(small.endsWith('step 29')).toBe(true);
  expect(resumeContext(carnet, session, { maxCharacters: 50 })).toHaveLength(50);
});

test('a session started by rucher gets context only on resume', () => {
  const { carnet, root } = withSession();
  const base = { session_id: SESSION, cwd: root };
  const env = { RUCHER_SESSION_ID: SESSION, RUCHER_PROMPT_VERSION: rulesVersion(carnet.group, {}) };
  expect(handleSessionStart(carnet, { ...base, source: 'startup' }, env).additionalContext).toBe(
    undefined,
  );
  const resumed = handleSessionStart(carnet, { ...base, source: 'resume' }, env);
  expect(resumed.additionalContext).toContain('state when resumed');
});

test('resume context shows the session notes as a summary line', () => {
  const { carnet } = withSession();
  carnet.notes.add({
    kind: 'decision',
    text: 'auth stays cookie based: partners need cookies',
    session: SESSION,
  });
  const context = resumeContext(carnet, carnet.sessions.require(SESSION));
  expect(context).toContain('Notes  1 added');
  expect(context).not.toContain('+ #1');
});

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { claudeCode } from '../src/index.ts';
import { SESSION, tempDirectory } from './helpers.ts';

function payload(extra: Record<string, unknown>) {
  return JSON.stringify({ session_id: SESSION, agent_id: 'id-a', ...extra });
}

test('the own background task description names the subagent', () => {
  const parsed = claudeCode.parseSubagentPayload(
    payload({
      background_tasks: [
        { id: 'id-b', description: 'bravo' },
        { id: 'id-a', description: 'alpha' },
      ],
    }),
  );
  expect(claudeCode.subagentNames(parsed)).toEqual(['alpha']);
});

test('metadata and prompt in the subagent transcript name it when the payload does not', () => {
  const directory = tempDirectory();
  mkdirSync(directory, { recursive: true });
  const transcript = join(directory, 'agent-id-a.jsonl');
  writeFileSync(
    transcript,
    `${JSON.stringify({ type: 'user', message: { content: 'You are fork `shop-auth`. Do it.' } })}\n`,
  );
  const parsed = claudeCode.parseSubagentPayload(payload({ agent_transcript_path: transcript }));
  expect(claudeCode.subagentNames(parsed)).toEqual(['shop-auth']);
  writeFileSync(join(directory, 'agent-id-a.meta.json'), JSON.stringify({ description: 'Audit' }));
  expect(claudeCode.subagentNames(parsed)).toEqual(['Audit', 'shop-auth']);
});

test('no name source gives no names', () => {
  expect(claudeCode.subagentNames(claudeCode.parseSubagentPayload(payload({})))).toEqual([]);
});

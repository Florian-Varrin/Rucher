import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';
import { CORE_RULES_PATH, extractCoreRules, renderCoreRules } from '../scripts/prompt-core.ts';
import { WORKFLOW_PATH } from '../scripts/skill.ts';

test('the core rules are generated from docs/workflow.md', () => {
  expect(readFileSync(CORE_RULES_PATH, 'utf8')).toBe(
    renderCoreRules(readFileSync(WORKFLOW_PATH, 'utf8')),
  );
});

test('the core rules section is extracted and escaped for a template literal', () => {
  const workflow =
    'intro\n<!-- prompt:core start -->\n- use `rucher` and ${x}\n<!-- prompt:core end -->\nrest';
  expect(extractCoreRules(workflow)).toBe('- use `rucher` and ${x}');
  expect(renderCoreRules(workflow)).toContain('- use \\`rucher\\` and \\${x}');
  expect(() => extractCoreRules('no markers')).toThrow(/prompt:core/);
});

test('the core rules stay short and out of the skill', () => {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
  expect(extractCoreRules(workflow).length).toBeLessThan(1200);
  const skipped = workflow.slice(workflow.lastIndexOf('<!-- skill:skip start -->'));
  expect(skipped).toContain('<!-- prompt:core start -->');
});

import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';
import { renderSkill, SKILL_PATH, WORKFLOW_PATH } from '../scripts/skill.ts';

test('the plugin skill is generated from docs/workflow.md', () => {
  expect(readFileSync(SKILL_PATH, 'utf8')).toBe(renderSkill(readFileSync(WORKFLOW_PATH, 'utf8')));
});

test('the skill leaves out the human-only sections', () => {
  const skill = renderSkill(readFileSync(WORKFLOW_PATH, 'utf8'));
  expect(skill).toMatch(/^---\nname: rucher\ndescription: /);
  expect(skill).not.toContain('skill:skip');
  expect(skill).not.toContain('## Groups on disk');
  expect(skill).toContain('## Dispatching a fork');
  expect(skill).toContain('<workspace>/reports/<name>.md');
});

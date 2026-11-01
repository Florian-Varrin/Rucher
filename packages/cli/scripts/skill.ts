import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const WORKFLOW_PATH = `${repositoryRoot}docs/workflow.md`;
export const SKILL_PATH = `${repositoryRoot}plugin/skills/rucher/SKILL.md`;

const FRONTMATTER = `---
name: rucher
description: Rucher multi-agent workflow for Claude Code. Dispatch forks (sub-agents) in parallel, track them in Carnet, then apply, test and commit their work one at a time. Use when the user asks to start, run, review or apply forks, to work in parallel, to see what is waiting, or invokes /rucher.
---
`;

export function renderSkill(workflow: string): string {
  const body = workflow
    .replace(/<!-- skill:skip start -->[\s\S]*?<!-- skill:skip end -->\n?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `${FRONTMATTER}\n<!-- Generated from docs/workflow.md by pnpm run build. Do not edit. -->\n\n${body}\n`;
}

export function writeSkill(): void {
  writeFileSync(SKILL_PATH, renderSkill(readFileSync(WORKFLOW_PATH, 'utf8')));
}

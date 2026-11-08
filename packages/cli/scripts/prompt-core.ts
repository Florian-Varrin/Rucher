import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WORKFLOW_PATH } from './skill.ts';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const CORE_RULES_PATH = `${repositoryRoot}packages/carnet/src/prompt/core-rules.ts`;

export function extractCoreRules(workflow: string): string {
  const match = /<!-- prompt:core start -->([\s\S]*?)<!-- prompt:core end -->/.exec(workflow);
  if (!match?.[1]) throw new Error('docs/workflow.md has no prompt:core section');
  return match[1].trim();
}

export function renderCoreRules(workflow: string): string {
  const rules = extractCoreRules(workflow).replace(/[`\\]/g, '\\$&').replace(/\$\{/g, '\\${');
  return `// Generated from docs/workflow.md by pnpm run build. Do not edit.\nexport const CORE_RULES = \`${rules}\`;\n`;
}

export function writeCoreRules(): void {
  writeFileSync(CORE_RULES_PATH, renderCoreRules(readFileSync(WORKFLOW_PATH, 'utf8')));
}

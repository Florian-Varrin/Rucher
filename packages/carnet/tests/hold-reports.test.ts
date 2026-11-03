import { expect, test } from 'vite-plus/test';
import { CORE_RULES } from '../src/index.ts';
import { INSTRUCTIONS } from '../src/mcp/index.ts';

test('the core rules and the server instructions both hold fork reports until the human asks', () => {
  for (const text of [CORE_RULES, INSTRUCTIONS]) {
    expect(text).toContain('"<name> finished, report ready"');
    expect(text).toMatch(/until the human asks|only when the human asks/);
    expect(text).toContain('carries no results');
  }
});

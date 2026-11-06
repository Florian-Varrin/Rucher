import { expect, test } from 'vite-plus/test';
import { CORE_RULES, outsideRucherContext } from '../src/index.ts';
import { makeCarnet } from './helpers.ts';

test('the core rules hold fork reports until the human asks, also outside rucher', () => {
  const { carnet } = makeCarnet();
  for (const text of [CORE_RULES, outsideRucherContext(carnet.requireWorkspace(), {})]) {
    expect(text).toContain('"<name> finished, report ready"');
    expect(text).toMatch(/until the human asks|only when the human asks/);
    expect(text).toContain('carries no results');
  }
});

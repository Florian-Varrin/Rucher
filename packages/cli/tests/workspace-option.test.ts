import { expect, test } from 'vite-plus/test';
import { withoutWorkspaceOption } from '../src/main.ts';

test('the workspace option and its value never read as positionals of a launch', () => {
  expect(withoutWorkspaceOption(['shop-auth', '--ws', 'shop', '--active'])).toEqual([
    'shop-auth',
    '--active',
  ]);
  expect(withoutWorkspaceOption(['--ws', 'shop', 'shop-auth'])).toEqual(['shop-auth']);
  expect(withoutWorkspaceOption(['--ws=shop', 'shop-auth', '--ws=shop'])).toEqual(['shop-auth']);
});

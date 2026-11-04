import { expect, test } from 'vite-plus/test';
import { withoutGroupOption } from '../src/main.ts';

test('the group option and its value never read as positionals of a launch', () => {
  expect(withoutGroupOption(['shop-auth', '-g', 'shop', '--active'])).toEqual([
    'shop-auth',
    '--active',
  ]);
  expect(withoutGroupOption(['--group', 'shop', 'shop-auth'])).toEqual(['shop-auth']);
  expect(withoutGroupOption(['--group=shop', 'shop-auth', '-g=shop'])).toEqual(['shop-auth']);
});

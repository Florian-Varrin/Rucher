import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import {
  addGroupRepo,
  type CarnetError,
  createGroup,
  databasePath,
  dropGroup,
  listGroups,
  loadGroup,
  openCarnet,
  openGroupCarnet,
  removeGroupRepo,
  renameGroup,
  repoNameFor,
  repoPathFor,
  resolveGroup,
  rucherPaths,
  sessionGroupName,
} from '../src/index.ts';
import { tempDirectory, testHome } from './helpers.ts';

function setup() {
  const api = tempDirectory('repo-api-');
  const web = tempDirectory('repo-web-');
  mkdirSync(join(api, 'src', 'deep'), { recursive: true });
  return { api, web, env: testHome() };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as CarnetError).code;
  }
}

test('RUCHER_HOME holds every location, XDG variables otherwise', () => {
  expect(rucherPaths({ RUCHER_HOME: '/r' })).toEqual({
    config: '/r/config',
    data: '/r/data',
    state: '/r/state',
    run: '/r/run',
  });
  expect(rucherPaths({ HOME: '/home/shop' })).toEqual({
    config: '/home/shop/.config/rucher',
    data: '/home/shop/.local/share/rucher',
    state: '/home/shop/.local/state/rucher',
    run: '/home/shop/.local/state/rucher/run',
  });
  const xdg = rucherPaths({
    HOME: '/home/shop',
    XDG_CONFIG_HOME: '/x/config',
    XDG_DATA_HOME: 'relative/data',
    XDG_RUNTIME_DIR: '/run/user/1000',
  });
  expect(xdg.config).toBe('/x/config/rucher');
  expect(xdg.data).toBe('/home/shop/.local/share/rucher');
  expect(xdg.run).toBe('/run/user/1000/rucher');
  expect(databasePath({ RUCHER_HOME: '/r' })).toBe('/r/data/carnet.db');
});

test('createGroup writes the definition and the run directory, the file system is the registry', () => {
  const { api, env } = setup();
  const group = createGroup('shop', { env, repos: [api] });
  const home = env.RUCHER_HOME as string;
  expect(group.definition).toBe(join(home, 'config', 'groups', 'shop'));
  expect(group.runDirectory).toBe(join(home, 'data', 'workspaces', 'shop'));
  expect(existsSync(group.runDirectory)).toBe(true);
  expect(readFileSync(join(group.definition, 'CLAUDE.md'), 'utf8')).toBe('');
  expect(JSON.parse(readFileSync(join(group.definition, 'group.json'), 'utf8'))).toEqual({
    name: 'shop',
    workspace: group.runDirectory,
    repos: [{ path: api, name: group.repos[0]?.name }],
    backends: {},
  });
  expect(listGroups(env).map((listed) => listed.name)).toEqual(['shop']);
  expect(codeOf(() => createGroup('shop', { env }))).toBe('GROUP_EXISTS');
  expect(codeOf(() => createGroup('Shop', { env }))).toBe('GROUP_NAME_INVALID');
  expect(codeOf(() => createGroup('cart', { env, repos: ['/nope'] }))).toBe('REPO_NOT_FOUND');
  expect(codeOf(() => loadGroup('cart', env))).toBe('GROUP_NOT_FOUND');
});

test('loadGroup expands ~ and names repos after their folder unless group.json names them', () => {
  const { env } = setup();
  const home = tempDirectory('user-');
  mkdirSync(join(home, 'code', 'shop-api'), { recursive: true });
  const group = createGroup('shop', { env });
  writeFileSync(
    join(group.definition, 'group.json'),
    JSON.stringify({
      name: 'shop',
      repos: [{ path: '~/code/shop-api' }, { path: '~/code/shop-web', name: 'web' }],
    }),
  );
  const loaded = loadGroup('shop', { ...env, HOME: home });
  expect(loaded.repos).toEqual([
    { path: join(home, 'code', 'shop-api'), name: 'shop-api' },
    { path: join(home, 'code', 'shop-web'), name: 'web' },
  ]);
  expect(loaded.runDirectory).toBe(join(env.RUCHER_HOME as string, 'data', 'workspaces', 'shop'));
});

test('addGroupRepo and removeGroupRepo keep the other fields of group.json', () => {
  const { api, web, env } = setup();
  const group = createGroup('shop', { env, repos: [api] });
  const file = join(group.definition, 'group.json');
  const settings = { 'claude-code': { settings: { model: 'opus' } } };
  writeFileSync(
    file,
    JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), backends: settings }),
  );
  expect(addGroupRepo('shop', web, env).repos.map((repo) => repo.path)).toEqual([api, web]);
  expect(addGroupRepo('shop', web, env).repos).toHaveLength(2);
  expect(removeGroupRepo('shop', api, env).repos.map((repo) => repo.path)).toEqual([web]);
  expect(loadGroup('shop', env).backends).toEqual(settings);
  expect(codeOf(() => removeGroupRepo('shop', api, env))).toBe('REPO_NOT_FOUND');
});

test('renameGroup moves the definition only, the run directory keeps its path', () => {
  const { env } = setup();
  const group = createGroup('shop', { env });
  const renamed = renameGroup('shop', 'store', env);
  expect(renamed.name).toBe('store');
  expect(renamed.runDirectory).toBe(group.runDirectory);
  expect(existsSync(group.definition)).toBe(false);
  expect(listGroups(env).map((listed) => listed.name)).toEqual(['store']);
  createGroup('shop', { env });
  expect(codeOf(() => renameGroup('store', 'shop', env))).toBe('GROUP_EXISTS');
});

test('dropGroup removes the definition, and the run directory with purge', () => {
  const { env } = setup();
  const kept = createGroup('shop', { env });
  dropGroup('shop', { env });
  expect(existsSync(kept.definition)).toBe(false);
  expect(existsSync(kept.runDirectory)).toBe(true);
  const purged = createGroup('cart', { env });
  dropGroup('cart', { env, purge: true });
  expect(existsSync(purged.runDirectory)).toBe(false);
  expect(listGroups(env)).toEqual([]);
});

test('repoNameFor and repoPathFor match the repo containing a path', () => {
  const { api, env } = setup();
  const group = createGroup('shop', { env, repos: [api] });
  const name = group.repos[0]?.name as string;
  expect(repoNameFor(group, join(api, 'src'))).toBe(name);
  expect(repoNameFor(group, tempDirectory())).toBeNull();
  expect(repoNameFor(null, api)).toBeNull();
  expect(repoPathFor(group, join(api, 'src', 'deep'))).toBe(join(name, 'src', 'deep'));
  expect(repoPathFor(group, api)).toBe(name);
});

test('resolution: option, then RUCHER_GROUP, then run directory, then repo, else no group', () => {
  const { api, web, env } = setup();
  const shop = createGroup('shop', { env, repos: [api] });
  createGroup('cart', { env, repos: [web] });
  expect(resolveGroup({ cwd: api, env, group: 'cart' })).toMatchObject({
    origin: 'option',
    group: { name: 'cart' },
  });
  expect(resolveGroup({ cwd: api, env: { ...env, RUCHER_GROUP: 'cart' } })).toMatchObject({
    origin: 'env',
    group: { name: 'cart' },
  });
  mkdirSync(join(shop.runDirectory, 'reports'), { recursive: true });
  expect(resolveGroup({ cwd: join(shop.runDirectory, 'reports'), env })).toMatchObject({
    origin: 'run-directory',
    group: { name: 'shop' },
  });
  expect(resolveGroup({ cwd: join(api, 'src', 'deep'), env })).toMatchObject({
    origin: 'repo',
    group: { name: 'shop' },
    repo: { path: api },
  });
  expect(resolveGroup({ cwd: tempDirectory(), env })).toEqual({ group: null, origin: 'none' });
  expect(codeOf(() => resolveGroup({ cwd: api, env, group: 'nope' }))).toBe('GROUP_NOT_FOUND');
});

test('the longest repo prefix wins, an equal prefix in two groups is ambiguous', () => {
  const { api, env } = setup();
  const nested = join(api, 'src');
  createGroup('shop', { env, repos: [api] });
  createGroup('shop-mobile', { env, repos: [nested] });
  expect(resolveGroup({ cwd: join(nested, 'deep'), env }).group?.name).toBe('shop-mobile');
  expect(resolveGroup({ cwd: api, env }).group?.name).toBe('shop');
  createGroup('cart', { env, repos: [api] });
  expect(codeOf(() => resolveGroup({ cwd: api, env }))).toBe('GROUP_AMBIGUOUS');
});

test('a known session id gives its group before anything else', () => {
  const { api, web, env } = setup();
  createGroup('shop', { env, repos: [api] });
  createGroup('cart', { env, repos: [web] });
  const carnet = openCarnet({ group: 'cart', env });
  carnet.sessions.create({ id: 'session-in-cart', kind: 'temp', cwd: api });
  expect(sessionGroupName(carnet.db, 'session-in-cart')).toBe('cart');
  expect(
    resolveGroup({ db: carnet.db, sessionId: 'session-in-cart', cwd: api, env, group: 'shop' }),
  ).toMatchObject({ origin: 'session', group: { name: 'cart' } });
  openGroupCarnet(null, { env }).sessions.create({ id: 'loose', kind: 'temp', cwd: api });
  expect(resolveGroup({ db: carnet.db, sessionId: 'loose', cwd: api, env })).toEqual({
    group: null,
    origin: 'session',
  });
  expect(resolveGroup({ db: carnet.db, sessionId: 'unknown', cwd: api, env }).group?.name).toBe(
    'shop',
  );
  carnet.close();
});

test('openCarnet opens the one database whatever the group', () => {
  const { api, env } = setup();
  createGroup('shop', { env, repos: [api] });
  const carnet = openCarnet({ cwd: join(api, 'src'), env });
  expect(carnet.group?.name).toBe('shop');
  carnet.close();
  expect(existsSync(databasePath(env))).toBe(true);
  const outside = openCarnet({ cwd: tempDirectory(), env });
  expect(outside.group).toBeNull();
  outside.close();
});

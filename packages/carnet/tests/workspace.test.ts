import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import {
  addWorkspaceRepo,
  type CarnetError,
  createWorkspace,
  databasePath,
  dropWorkspace,
  listWorkspaces,
  loadWorkspace,
  openCarnet,
  openWorkspaceCarnet,
  removeWorkspaceRepo,
  repoNameFor,
  repoPathFor,
  resolveWorkspace,
  rucherPaths,
  sessionWorkspaceName,
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

test('createWorkspace writes the definition and the run directory, the file system is the registry', () => {
  const { api, env } = setup();
  const workspace = createWorkspace('shop', { env, repos: [api] });
  const home = env.RUCHER_HOME as string;
  expect(workspace.definition).toBe(join(home, 'config', 'workspaces', 'shop'));
  expect(workspace.runDirectory).toBe(join(home, 'data', 'workspaces', 'shop'));
  expect(existsSync(workspace.runDirectory)).toBe(true);
  expect(readFileSync(join(workspace.definition, 'CLAUDE.md'), 'utf8')).toBe('');
  expect(JSON.parse(readFileSync(join(workspace.definition, 'workspace.json'), 'utf8'))).toEqual({
    name: 'shop',
    repos: [{ path: api, name: workspace.repos[0]?.name }],
    backends: {},
  });
  expect(listWorkspaces(env).map((listed) => listed.name)).toEqual(['shop']);
  expect(codeOf(() => createWorkspace('shop', { env }))).toBe('WORKSPACE_EXISTS');
  expect(codeOf(() => createWorkspace('Shop', { env }))).toBe('WORKSPACE_NAME_INVALID');
  expect(codeOf(() => createWorkspace('cart', { env, repos: ['/nope'] }))).toBe('REPO_NOT_FOUND');
  expect(codeOf(() => loadWorkspace('cart', env))).toBe('WORKSPACE_NOT_FOUND');
});

test('loadWorkspace expands ~ and names repos after their folder unless workspace.json names them', () => {
  const { env } = setup();
  const home = tempDirectory('user-');
  mkdirSync(join(home, 'code', 'shop-api'), { recursive: true });
  const workspace = createWorkspace('shop', { env });
  writeFileSync(
    join(workspace.definition, 'workspace.json'),
    JSON.stringify({
      name: 'shop',
      repos: [{ path: '~/code/shop-api' }, { path: '~/code/shop-web', name: 'web' }],
    }),
  );
  const loaded = loadWorkspace('shop', { ...env, HOME: home });
  expect(loaded.repos).toEqual([
    { path: join(home, 'code', 'shop-api'), name: 'shop-api' },
    { path: join(home, 'code', 'shop-web'), name: 'web' },
  ]);
  expect(loaded.runDirectory).toBe(join(env.RUCHER_HOME as string, 'data', 'workspaces', 'shop'));
});

test('addWorkspaceRepo and removeWorkspaceRepo keep the other fields of workspace.json', () => {
  const { api, web, env } = setup();
  const workspace = createWorkspace('shop', { env, repos: [api] });
  const file = join(workspace.definition, 'workspace.json');
  const settings = { 'claude-code': { settings: { model: 'opus' } } };
  writeFileSync(
    file,
    JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), backends: settings }),
  );
  expect(addWorkspaceRepo('shop', web, env).repos.map((repo) => repo.path)).toEqual([api, web]);
  expect(addWorkspaceRepo('shop', web, env).repos).toHaveLength(2);
  expect(removeWorkspaceRepo('shop', api, env).repos.map((repo) => repo.path)).toEqual([web]);
  expect(loadWorkspace('shop', env).backends).toEqual(settings);
  expect(codeOf(() => removeWorkspaceRepo('shop', api, env))).toBe('REPO_NOT_FOUND');
});

test('dropWorkspace removes the definition, and the run directory with purge', () => {
  const { env } = setup();
  const kept = createWorkspace('shop', { env });
  dropWorkspace('shop', { env });
  expect(existsSync(kept.definition)).toBe(false);
  expect(existsSync(kept.runDirectory)).toBe(true);
  const purged = createWorkspace('cart', { env });
  dropWorkspace('cart', { env, purge: true });
  expect(existsSync(purged.runDirectory)).toBe(false);
  expect(listWorkspaces(env)).toEqual([]);
});

test('repoNameFor and repoPathFor match the repo containing a path', () => {
  const { api, env } = setup();
  const workspace = createWorkspace('shop', { env, repos: [api] });
  const name = workspace.repos[0]?.name as string;
  expect(repoNameFor(workspace, join(api, 'src'))).toBe(name);
  expect(repoNameFor(workspace, tempDirectory())).toBeNull();
  expect(repoNameFor(null, api)).toBeNull();
  expect(repoPathFor(workspace, join(api, 'src', 'deep'))).toBe(join(name, 'src', 'deep'));
  expect(repoPathFor(workspace, api)).toBe(name);
});

test('resolution: option, then RUCHER_WS, then run directory, then repo, else no workspace', () => {
  const { api, web, env } = setup();
  const shop = createWorkspace('shop', { env, repos: [api] });
  createWorkspace('cart', { env, repos: [web] });
  expect(resolveWorkspace({ cwd: api, env, workspace: 'cart' })).toMatchObject({
    origin: 'option',
    workspace: { name: 'cart' },
  });
  expect(resolveWorkspace({ cwd: api, env: { ...env, RUCHER_WS: 'cart' } })).toMatchObject({
    origin: 'env',
    workspace: { name: 'cart' },
  });
  mkdirSync(join(shop.runDirectory, 'reports'), { recursive: true });
  expect(resolveWorkspace({ cwd: join(shop.runDirectory, 'reports'), env })).toMatchObject({
    origin: 'run-directory',
    workspace: { name: 'shop' },
  });
  expect(resolveWorkspace({ cwd: join(api, 'src', 'deep'), env })).toMatchObject({
    origin: 'repo',
    workspace: { name: 'shop' },
    repo: { path: api },
  });
  expect(resolveWorkspace({ cwd: tempDirectory(), env })).toEqual({
    workspace: null,
    origin: 'none',
  });
  expect(codeOf(() => resolveWorkspace({ cwd: api, env, workspace: 'nope' }))).toBe(
    'WORKSPACE_NOT_FOUND',
  );
});

test('the longest repo prefix wins, an equal prefix in two workspaces is ambiguous', () => {
  const { api, env } = setup();
  const nested = join(api, 'src');
  createWorkspace('shop', { env, repos: [api] });
  createWorkspace('shop-mobile', { env, repos: [nested] });
  expect(resolveWorkspace({ cwd: join(nested, 'deep'), env }).workspace?.name).toBe('shop-mobile');
  expect(resolveWorkspace({ cwd: api, env }).workspace?.name).toBe('shop');
  createWorkspace('cart', { env, repos: [api] });
  expect(codeOf(() => resolveWorkspace({ cwd: api, env }))).toBe('WORKSPACE_AMBIGUOUS');
});

test('a known session id gives its workspace before anything else', () => {
  const { api, web, env } = setup();
  createWorkspace('shop', { env, repos: [api] });
  createWorkspace('cart', { env, repos: [web] });
  const carnet = openCarnet({ workspace: 'cart', env });
  carnet.sessions.create({ id: 'session-in-cart', kind: 'temp', cwd: api });
  expect(sessionWorkspaceName(carnet.db, 'session-in-cart')).toBe('cart');
  expect(
    resolveWorkspace({
      db: carnet.db,
      sessionId: 'session-in-cart',
      cwd: api,
      env,
      workspace: 'shop',
    }),
  ).toMatchObject({ origin: 'session', workspace: { name: 'cart' } });
  openWorkspaceCarnet(null, { env }).sessions.create({ id: 'loose', kind: 'temp', cwd: api });
  expect(resolveWorkspace({ db: carnet.db, sessionId: 'loose', cwd: api, env })).toEqual({
    workspace: null,
    origin: 'session',
  });
  expect(
    resolveWorkspace({ db: carnet.db, sessionId: 'unknown', cwd: api, env }).workspace?.name,
  ).toBe('shop');
  carnet.close();
});

test('openCarnet opens the one database whatever the workspace', () => {
  const { api, env } = setup();
  createWorkspace('shop', { env, repos: [api] });
  const carnet = openCarnet({ cwd: join(api, 'src'), env });
  expect(carnet.workspace?.name).toBe('shop');
  carnet.close();
  expect(existsSync(databasePath(env))).toBe(true);
  const outside = openCarnet({ cwd: tempDirectory(), env });
  expect(outside.workspace).toBeNull();
  outside.close();
});

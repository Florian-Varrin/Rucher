import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createWorkspace,
  loadWorkspace,
  openWorkspaceCarnet,
  workspaceExists,
} from '@rucher/carnet';
import { expect, test } from 'vite-plus/test';
import {
  workspaceAdd,
  workspaceCreate,
  workspaceDrop,
  workspaceEdit,
  workspaceErrors,
  workspaceList,
  workspacePath,
  workspaceRemove,
  workspaceShow,
  workspaceSync,
} from '../src/commands/ws.ts';
import { makeIo, SESSION, tempDirectory } from './helpers.ts';

function setup() {
  const env = { RUCHER_HOME: tempDirectory('home-') };
  const api = tempDirectory('shop-api-');
  const web = tempDirectory('shop-web-');
  const workspace = createWorkspace('shop', { env, repos: [api] });
  return { env, api, web, workspace };
}

test('ws show names the workspace, its definition, run directory and repos', () => {
  const { env, api, workspace } = setup();
  const io = makeIo({ env, cwd: api });
  expect(workspaceShow(io)).toBe(0);
  const output = io.output.join('');
  expect(output).toContain(`definition: ${workspace.definition}`);
  expect(output).toContain(`run directory: ${workspace.runDirectory}`);
  expect(output).toContain(api);
  const outside = makeIo({ env });
  expect(workspaceShow(outside)).toBe(1);
  expect(outside.errors.join('')).toContain('error:');
});

test('the workspace comes from --ws first, and a guess from the directory is said on stderr', () => {
  const { env, api } = setup();
  createWorkspace('blog', { env });
  const fromRepo = makeIo({ env, cwd: api });
  expect(workspacePath(fromRepo)).toBe(0);
  expect(fromRepo.errors.join('')).toMatch(/^workspace shop \(from shop-api-/);
  const named = makeIo({ env, cwd: api });
  expect(workspacePath(named, { workspace: 'blog' })).toBe(0);
  expect(named.output.join('')).toBe(`${loadWorkspace('blog', env).runDirectory}\n`);
  expect(named.errors).toEqual([]);
  const fromEnv = makeIo({ env: { ...env, RUCHER_WS: 'blog' }, cwd: api });
  expect(workspacePath(fromEnv)).toBe(0);
  expect(fromEnv.output.join('')).toContain('blog');
  expect(fromEnv.errors).toEqual([]);
  const fromRunDirectory = makeIo({ env, cwd: loadWorkspace('shop', env).runDirectory });
  expect(workspacePath(fromRunDirectory, { definition: true })).toBe(0);
  expect(fromRunDirectory.output.join('')).toBe(`${loadWorkspace('shop', env).definition}\n`);
  expect(fromRunDirectory.errors.join('')).toBe('workspace shop (from its run directory)\n');
});

test('ws add and remove change workspace.json and render the run directory', () => {
  const { env, api, web } = setup();
  const add = makeIo({ env });
  expect(workspaceAdd(web, add, { workspace: 'shop' })).toBe(0);
  expect(add.output.join('')).toMatch(/^added shop-web-/);
  expect(loadWorkspace('shop', env).repos.map((repo) => repo.path)).toEqual([api, web]);
  const remove = makeIo({ env });
  expect(workspaceRemove(api, remove, { workspace: 'shop' })).toBe(0);
  expect(loadWorkspace('shop', env).repos.map((repo) => repo.path)).toEqual([web]);
  const again = makeIo({ env });
  expect(workspaceRemove(api, again, { workspace: 'shop' })).toBe(1);
  expect(again.errors.join('')).toContain('is not a repo of');
});

test('ws sync renders, then reports nothing to do', () => {
  const { env } = setup();
  const first = makeIo({ env });
  expect(workspaceSync(first, { workspace: 'shop' })).toBe(0);
  const second = makeIo({ env });
  expect(workspaceSync(second, { workspace: 'shop' })).toBe(0);
  expect(second.output.join('')).toBe('shop already in sync\n');
});

test('ws edit opens the instructions, then syncs', async () => {
  const { env, workspace } = setup();
  const io = makeIo({ env });
  const opened: string[] = [];
  const code = await workspaceEdit(io, {
    workspace: 'shop',
    openEditor: (file) => {
      opened.push(file);
      writeFileSync(file, '# shop\n');
      return 0;
    },
  });
  expect(code).toBe(0);
  expect(opened).toEqual([join(workspace.definition, 'CLAUDE.md')]);
  expect(readFileSync(join(workspace.definition, 'CLAUDE.md'), 'utf8')).toBe('# shop\n');
});

test('ws edit opens AGENTS.md when the definition uses it, and reports both files', async () => {
  const { env, workspace } = setup();
  rmSync(join(workspace.definition, 'CLAUDE.md'));
  writeFileSync(join(workspace.definition, 'AGENTS.md'), '# shop\n');
  const opened: string[] = [];
  const openEditor = (file: string) => {
    opened.push(file);
    return 0;
  };
  expect(await workspaceEdit(makeIo({ env }), { workspace: 'shop', openEditor })).toBe(0);
  expect(opened).toEqual([join(workspace.definition, 'AGENTS.md')]);
  writeFileSync(join(workspace.definition, 'CLAUDE.md'), '# shop\n');
  const io = makeIo({ env });
  expect(await workspaceEdit(io, { workspace: 'shop', openEditor })).toBe(1);
  expect(io.errors.join('')).toContain('remove CLAUDE.md');
  expect(opened).toHaveLength(1);
});

test('ws edit --json restores an invalid workspace.json unless asked to edit again', async () => {
  const { env, workspace } = setup();
  const file = join(workspace.definition, 'workspace.json');
  const original = readFileSync(file, 'utf8');
  const io = makeIo({ env });
  const aborted = await workspaceEdit(io, {
    workspace: 'shop',
    json: true,
    openEditor: (path) => {
      writeFileSync(path, '{ broken');
      return 0;
    },
    confirm: async () => false,
  });
  expect(aborted).toBe(1);
  expect(io.errors.join('')).toContain('workspace.json is invalid');
  expect(readFileSync(file, 'utf8')).toBe(original);

  let round = 0;
  const fixed = await workspaceEdit(makeIo({ env }), {
    workspace: 'shop',
    json: true,
    openEditor: (path) => {
      round += 1;
      writeFileSync(path, round === 1 ? '{ broken' : original);
      return 0;
    },
    confirm: async () => true,
  });
  expect(fixed).toBe(0);
  expect(round).toBe(2);

  const failing = makeIo({ env });
  expect(await workspaceEdit(failing, { workspace: 'shop', openEditor: () => 1 })).toBe(1);
  expect(failing.errors.join('')).toContain('exited with an error');
});

function home() {
  return { RUCHER_HOME: tempDirectory('home-') };
}

function sessionIn(name: string, env: NodeJS.ProcessEnv, hostPid?: number) {
  const workspace = loadWorkspace(name, env);
  const carnet = openWorkspaceCarnet(workspace, { env });
  carnet.sessions.upsertFromHook(
    { session_id: SESSION, cwd: workspace.runDirectory, source: 'startup' },
    { processId: hostPid ?? null },
  );
  carnet.sessions.name(SESSION, 'shop-auth', 'Login flow');
  if (hostPid)
    carnet.db.prepare("UPDATE sessions SET status = 'running' WHERE id = ?").run(SESSION);
  carnet.notes.add({ kind: 'learning', text: 'The api needs a seed before tests' });
  carnet.close();
}

test('ws list shows each workspace with its repo and session counts', () => {
  const env = home();
  createWorkspace('shop', { env, repos: [tempDirectory('shop-api-')] });
  const blog = createWorkspace('blog', { env });
  sessionIn('shop', env);
  const io = makeIo({ env });
  expect(workspaceList(io)).toBe(0);
  const lines = io.output.join('').trimEnd().split('\n');
  expect(lines).toHaveLength(2);
  expect(lines[0]).toBe(`blog  0 repos  0 sessions  ${blog.runDirectory}`);
  expect(lines[1]).toMatch(/^shop  1 repo  1 session  /);
  const empty = makeIo({ env: home() });
  expect(workspaceList(empty)).toBe(0);
  expect(empty.output.join('')).toContain('no workspace yet');
});

test('ws create writes the definition and renders the run directory', () => {
  const env = home();
  const api = tempDirectory('shop-api-');
  const io = makeIo({ env });
  expect(workspaceCreate('shop', io, { repos: [api] })).toBe(0);
  const workspace = loadWorkspace('shop', env);
  expect(workspace.repos.map((repo) => repo.path)).toEqual([api]);
  expect(existsSync(join(workspace.definition, 'CLAUDE.md'))).toBe(true);
  expect(existsSync(workspace.runDirectory)).toBe(true);
  const output = io.output.join('');
  expect(output).toContain('shop created');
  expect(output).toContain(`run directory: ${workspace.runDirectory}`);
  expect(output).toContain('rucher new <session> --ws shop');

  const again = makeIo({ env });
  expect(workspaceErrors(again, () => workspaceCreate('shop', again))).toBe(1);
  expect(again.errors.join('')).toContain('already exists');
  const invalid = makeIo({ env });
  expect(workspaceErrors(invalid, () => workspaceCreate('Shop', invalid))).toBe(1);
});

test('ws drop refuses while a session of the workspace is running', () => {
  const env = home();
  createWorkspace('shop', { env });
  sessionIn('shop', env, 4242);
  const drop = makeIo({ env });
  expect(workspaceErrors(drop, () => workspaceDrop('shop', drop, { isAlive: () => true }))).toBe(1);
  expect(drop.errors.join('')).toContain('1 session of shop still running: shop-auth');
  expect(workspaceExists('shop', env)).toBe(true);
  const gone = makeIo({ env });
  expect(workspaceErrors(gone, () => workspaceDrop('nope', gone))).toBe(1);
});

test('ws drop archives the sessions and keeps notes and run directory; --purge deletes them', () => {
  const env = home();
  const runDirectory = createWorkspace('shop', { env }).runDirectory;
  sessionIn('shop', env);
  const io = makeIo({ env });
  expect(workspaceDrop('shop', io, { isAlive: () => false })).toBe(0);
  expect(io.output.join('')).toContain('sessions archived: 1');
  expect(workspaceExists('shop', env)).toBe(false);
  expect(existsSync(runDirectory)).toBe(true);

  const back = createWorkspace('shop', { env });
  const carnet = openWorkspaceCarnet(back, { env });
  expect(carnet.sessions.get(SESSION)?.status).toBe('archived');
  expect(carnet.notes.list()).toHaveLength(1);
  carnet.close();

  const purge = makeIo({ env });
  expect(workspaceDrop('shop', purge, { purge: true, isAlive: () => false })).toBe(0);
  expect(purge.output.join('')).toContain('notes deleted: 1');
  expect(existsSync(back.runDirectory)).toBe(false);
  const empty = openWorkspaceCarnet(createWorkspace('shop', { env }), { env });
  expect(empty.notes.list()).toHaveLength(0);
  empty.close();
  expect(readFileSync(join(loadWorkspace('shop', env).definition, 'CLAUDE.md'), 'utf8')).toBe('');
});

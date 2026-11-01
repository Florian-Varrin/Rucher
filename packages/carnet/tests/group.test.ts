import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  CarnetError,
  detectRepos,
  findGroupRoot,
  initGroup,
  loadGroup,
  locateGroup,
  openCarnet,
  readRegistry,
} from "../src/index.ts";
import { tempDir } from "./helpers.ts";

function metaDir(): { root: string; env: NodeJS.ProcessEnv } {
  const root = tempDir("meta-");
  mkdirSync(join(root, "api", ".git"), { recursive: true });
  mkdirSync(join(root, "web", ".git"), { recursive: true });
  mkdirSync(join(root, "notes"));
  mkdirSync(join(root, ".hidden", ".git"), { recursive: true });
  return { root, env: { RUCHER_HOME: tempDir("home-") } };
}

test("detectRepos lists visible child directories holding a .git", () => {
  const { root } = metaDir();
  expect(detectRepos(root)).toEqual(["api", "web"]);
});

test("initGroup creates the marker, the database and the registry entry", () => {
  const { root, env } = metaDir();
  const group = initGroup(root, { env });
  expect(group.name).toBe(root.split("/").at(-1));
  expect(group.repos).toEqual(["api", "web"]);
  expect(group.reposPinned).toBe(false);
  expect(existsSync(group.dbPath)).toBe(true);
  expect(loadGroup(root)).toEqual(group);
  mkdirSync(join(root, "infra", ".git"), { recursive: true });
  expect(loadGroup(root).repos).toEqual(["api", "infra", "web"]);
  expect(readRegistry(env)).toEqual([{ name: group.name, path: root }]);
});

test("initGroup refuses an existing group and honours explicit options", () => {
  const { root, env } = metaDir();
  initGroup(root, { env, name: "mycity", repos: ["api"] });
  expect(loadGroup(root)).toMatchObject({ name: "mycity", repos: ["api"], reposPinned: true });
  mkdirSync(join(root, "infra", ".git"), { recursive: true });
  expect(loadGroup(root).repos).toEqual(["api"]);
  expect(() => initGroup(root, { env })).toThrowError(CarnetError);
});

test("findGroupRoot walks up from a nested repo", () => {
  const { root, env } = metaDir();
  initGroup(root, { env });
  mkdirSync(join(root, "api", "src", "deep"), { recursive: true });
  expect(findGroupRoot(join(root, "api", "src", "deep"))).toBe(root);
  expect(findGroupRoot(tempDir("outside-"))).toBeNull();
});

test("locateGroup falls back to CLAUDE_PROJECT_DIR and errors with NO_GROUP", () => {
  const { root, env } = metaDir();
  initGroup(root, { env });
  const outside = tempDir("outside-");
  expect(locateGroup({ cwd: outside, env: { CLAUDE_PROJECT_DIR: join(root, "web") } }).root).toBe(
    root,
  );
  try {
    locateGroup({ cwd: outside, env: {} });
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(CarnetError);
    expect((error as CarnetError).code).toBe("NO_GROUP");
  }
});

test("openCarnet opens the group database from a nested cwd", () => {
  const { root, env } = metaDir();
  initGroup(root, { env });
  const carnet = openCarnet({ cwd: join(root, "api"), env });
  expect(carnet.group.root).toBe(root);
  expect(carnet.sessions.list()).toEqual([]);
  carnet.close();
});

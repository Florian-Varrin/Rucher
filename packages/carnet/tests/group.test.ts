import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  addGroupRepo,
  type CarnetError,
  findGroupRoot,
  initGroup,
  loadGroup,
  locateGroup,
  openCarnet,
  readRegistry,
  repoNameFor,
} from "../src/index.ts";
import { tempDir } from "./helpers.ts";

function setup() {
  const meta = tempDir("meta-");
  const api = tempDir("repo-api-");
  const web = tempDir("repo-web-");
  mkdirSync(join(api, "src", "deep"), { recursive: true });
  return { meta, api, web, env: { RUCHER_HOME: tempDir("home-") } };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as CarnetError).code;
  }
}

test("initGroup records repo paths, creates the database and the registry entry", () => {
  const { meta, api, web, env } = setup();
  const group = initGroup(meta, { env, repos: [api, web] });
  expect(group.name).toBe(meta.split("/").at(-1));
  expect(group.repos).toEqual([api, web]);
  expect(existsSync(group.dbPath)).toBe(true);
  expect(loadGroup(meta)).toEqual(group);
  expect(readRegistry(env)).toEqual([{ name: group.name, path: meta }]);
});

test("initGroup without repos, then addGroupRepo; missing paths are refused", () => {
  const { meta, api, env } = setup();
  expect(initGroup(meta, { env, name: "shop" }).repos).toEqual([]);
  expect(addGroupRepo(meta, api).repos).toEqual([api]);
  expect(addGroupRepo(meta, api).repos).toEqual([api]);
  expect(codeOf(() => addGroupRepo(meta, join(meta, "nope")))).toBe("REPO_NOT_FOUND");
  expect(codeOf(() => initGroup(meta, { env }))).toBe("GROUP_EXISTS");
});

test("findGroupRoot walks up inside the meta directory only", () => {
  const { meta, api, env } = setup();
  initGroup(meta, { env, repos: [api] });
  mkdirSync(join(meta, "notes", "deep"), { recursive: true });
  expect(findGroupRoot(join(meta, "notes", "deep"))).toBe(meta);
  expect(findGroupRoot(api)).toBeNull();
});

test("locateGroup falls back to the registry when started inside a repo", () => {
  const { meta, api, web, env } = setup();
  initGroup(meta, { env, repos: [api] });
  expect(locateGroup({ cwd: join(api, "src", "deep"), env }).root).toBe(meta);
  const elsewhere = tempDir("elsewhere-");
  expect(locateGroup({ cwd: elsewhere, env: { ...env, CLAUDE_PROJECT_DIR: api } }).root).toBe(meta);
  expect(codeOf(() => locateGroup({ cwd: web, env }))).toBe("NO_GROUP");
});

test("locateGroup skips a .rucher folder without group.json, like the registry home", () => {
  const home = tempDir("home-");
  const env = { RUCHER_HOME: join(home, ".rucher") };
  const api = join(home, "projects", "api");
  mkdirSync(api, { recursive: true });
  const meta = tempDir("meta-");
  initGroup(meta, { env, repos: [api] });
  expect(existsSync(join(home, ".rucher", "groups.json"))).toBe(true);
  expect(findGroupRoot(api)).toBeNull();
  expect(locateGroup({ cwd: api, env }).root).toBe(meta);
});

test("repoNameFor matches the repo containing a path", () => {
  const { meta, api, web, env } = setup();
  const group = initGroup(meta, { env, repos: [api, web] });
  expect(repoNameFor(group, join(api, "src"))).toBe(api.split("/").at(-1));
  expect(repoNameFor(group, meta)).toBeNull();
  expect(repoNameFor(group, `${api}-sibling`)).toBeNull();
  expect(repoNameFor(group, undefined)).toBeNull();
});

test("openCarnet opens the group database from a repo of the group", () => {
  const { meta, api, env } = setup();
  initGroup(meta, { env, repos: [api] });
  const carnet = openCarnet({ cwd: api, env });
  expect(carnet.group.root).toBe(meta);
  const session = carnet.sessions.upsertFromHook({ session_id: "s", cwd: join(api, "src") });
  expect(session.repo).toBe(api.split("/").at(-1));
  carnet.close();
});

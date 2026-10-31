import { expect, test } from "vite-plus/test";
import type { CarnetError } from "../src/index.ts";
import { createSessionResolver } from "../src/mcp/index.ts";
import { makeCarnet, SESSION } from "./helpers.ts";

test("resolves from CLAUDE_CODE_SESSION_ID, creating a temporary row, and caches it", () => {
  const { carnet, root } = makeCarnet();
  const resolver = createSessionResolver({
    carnet,
    env: { CLAUDE_CODE_SESSION_ID: SESSION },
    cwd: root,
    ppid: 1,
  });
  expect(resolver.resolve()).toBe(SESSION);
  expect(carnet.sessions.get(SESSION)).toMatchObject({ status: "temporary", cwd: root });
  const before = carnet.sessions.require(SESSION).lastActiveAt;
  expect(resolver.resolve()).toBe(SESSION);
  expect(carnet.sessions.require(SESSION).lastActiveAt > before).toBe(true);
});

test("falls back to the claude pid recorded by the hook", () => {
  const { carnet, root } = makeCarnet();
  carnet.sessions.upsertFromHook({ session_id: SESSION, cwd: root }, { CLAUDE_PID: "4242" });
  const resolver = createSessionResolver({ carnet, env: {}, ppid: 4242, cwd: root });
  expect(resolver.resolve()).toBe(SESSION);
});

test("an explicit session wins and is not cached", () => {
  const { carnet, root } = makeCarnet();
  const resolver = createSessionResolver({
    carnet,
    env: { CLAUDE_CODE_SESSION_ID: SESSION },
    cwd: root,
    ppid: 1,
  });
  expect(resolver.resolve("other")).toBe("other");
  expect(resolver.resolve()).toBe(SESSION);
  expect(carnet.sessions.list({ includeTemporary: true })).toHaveLength(2);
});

test("throws NO_SESSION when nothing identifies the session", () => {
  const { carnet, root } = makeCarnet();
  const resolver = createSessionResolver({ carnet, env: {}, ppid: 99, cwd: root });
  try {
    resolver.resolve();
    expect.unreachable();
  } catch (error) {
    expect((error as CarnetError).code).toBe("NO_SESSION");
  }
});

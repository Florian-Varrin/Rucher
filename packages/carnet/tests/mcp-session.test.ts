import { expect, test } from "vite-plus/test";
import type { CarnetError } from "../src/index.ts";
import { createSessionResolver } from "../src/mcp/index.ts";
import { makeCarnet, SESSION } from "./helpers.ts";

test("without a hook row, resolves from CLAUDE_CODE_SESSION_ID and creates a temporary row", () => {
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

test("resolves from the claude pid recorded by the hook", () => {
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

const PROVISIONAL = "a634d82e-3715-494b-815e-b84d7fb2f142";

test("the hook row for the parent pid wins over a provisional env id", () => {
  const { carnet, root } = makeCarnet();
  carnet.sessions.upsertFromHook(
    { session_id: SESSION, cwd: root, source: "resume" },
    { CLAUDE_PID: "7" },
  );
  const resolver = createSessionResolver({
    carnet,
    env: { CLAUDE_CODE_SESSION_ID: PROVISIONAL },
    ppid: 7,
    cwd: root,
  });
  expect(resolver.resolve()).toBe(SESSION);
  expect(carnet.sessions.get(PROVISIONAL)).toBeUndefined();
});

test("a resume hook arriving after the server started takes over on the next call", () => {
  const { carnet, root } = makeCarnet();
  const resolver = createSessionResolver({
    carnet,
    env: { CLAUDE_CODE_SESSION_ID: PROVISIONAL },
    ppid: 7,
    cwd: root,
  });
  expect(resolver.resolve()).toBe(PROVISIONAL);
  carnet.sessions.upsertFromHook(
    { session_id: PROVISIONAL, cwd: root, source: "startup" },
    { CLAUDE_PID: "7" },
  );
  carnet.sessions.upsertFromHook(
    { session_id: SESSION, cwd: root, source: "resume" },
    { CLAUDE_PID: "7" },
  );
  expect(resolver.resolve()).toBe(SESSION);
  carnet.sessions.upsertFromHook(
    { session_id: "cleared", cwd: root, source: "clear" },
    { CLAUDE_PID: "7" },
  );
  expect(resolver.resolve()).toBe("cleared");
});

test("after a --continue style resume, forks are paired in the real session", () => {
  const { carnet, root } = makeCarnet();
  carnet.sessions.upsertFromHook(
    { session_id: PROVISIONAL, cwd: root, source: "startup" },
    { CLAUDE_PID: "7" },
  );
  carnet.sessions.upsertFromHook(
    { session_id: SESSION, cwd: root, source: "resume" },
    { CLAUDE_PID: "7" },
  );
  const resolver = createSessionResolver({
    carnet,
    env: { CLAUDE_CODE_SESSION_ID: PROVISIONAL },
    ppid: 7,
    cwd: root,
  });
  carnet.agents.start(resolver.resolve(), { name: "lost", task: "task" });
  expect(carnet.agents.pairSubagent(SESSION, "agent-1")?.name).toBe("lost");
  expect(carnet.agents.stopSubagent(SESSION, "agent-1")?.status).toBe("review");
});

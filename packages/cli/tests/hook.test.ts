import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { initGroup, openCarnet } from "@rucher/carnet";
import { expect, test } from "vite-plus/test";
import { sessionStart } from "../src/commands/hook.ts";
import { makeIo, SESSION, tempDir } from "./helpers.ts";

function group() {
  const root = tempDir("meta-");
  const api = tempDir("repo-api-");
  mkdirSync(join(api, "src"), { recursive: true });
  const env = { RUCHER_HOME: tempDir("home-"), CLAUDE_PID: "4242" };
  initGroup(root, { env, repos: [api] });
  return { root, api, env };
}

test("records the session of a group with pid and repo", () => {
  const { root, api, env } = group();
  const io = makeIo({ env });
  const payload = JSON.stringify({
    session_id: SESSION,
    cwd: join(api, "src"),
    source: "startup",
  });
  expect(sessionStart(payload, io)).toBe(0);
  expect(io.out).toEqual([]);
  expect(io.err).toEqual([]);
  const carnet = openCarnet({ cwd: root, env });
  expect(carnet.sessions.get(SESSION)).toMatchObject({
    status: "temporary",
    repo: api.split("/").at(-1),
    claudePid: 4242,
  });
  carnet.close();
});

test("outside any group it stays silent and succeeds", () => {
  const io = makeIo({ env: { RUCHER_HOME: tempDir("home-") } });
  const payload = JSON.stringify({ session_id: SESSION, cwd: tempDir("nogroup-") });
  expect(sessionStart(payload, io)).toBe(0);
  expect(io.out).toEqual([]);
  expect(io.err).toEqual([]);
});

test("malformed input never fails the hook", () => {
  const io = makeIo();
  expect(sessionStart("not json", io)).toBe(0);
  expect(io.err.join("")).toMatch(/^rucher hook: /);
  const io2 = makeIo();
  expect(sessionStart("{}", io2)).toBe(0);
  expect(io2.err.join("")).toContain("session_id");
});

test("on resume it prints the session state as additional context", () => {
  const { api, env } = group();
  const startup = JSON.stringify({ session_id: SESSION, cwd: api, source: "startup" });
  sessionStart(startup, makeIo({ env }));
  const io = makeIo({ env });
  expect(
    sessionStart(JSON.stringify({ session_id: SESSION, cwd: api, source: "resume" }), io),
  ).toBe(0);
  const output = JSON.parse(io.out.join("")) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
  expect(output.hookSpecificOutput.additionalContext).toContain("state when resumed");
});

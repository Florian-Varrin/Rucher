import { expect, test } from "vite-plus/test";
import { handleSessionStart, resumeContext } from "../src/index.ts";
import { SESSION, withSession } from "./helpers.ts";

test("resume context keeps the status and drops the oldest events to fit", () => {
  const { carnet } = withSession();
  for (let i = 0; i < 30; i++) carnet.events.log(SESSION, { type: "tested", note: `step ${i}` });
  const session = carnet.sessions.require(SESSION);
  const full = resumeContext(carnet, session);
  expect(full).toContain("Waiting on you");
  expect(full).not.toContain("step 9\n");
  expect(full).toContain("step 10");
  expect(full.endsWith("step 29")).toBe(true);

  const small = resumeContext(carnet, session, { maxChars: 400 });
  expect(small.length).toBeLessThanOrEqual(400);
  expect(small).toContain("Waiting on you");
  expect(small.endsWith("step 29")).toBe(true);
  expect(resumeContext(carnet, session, { maxChars: 50 })).toHaveLength(50);
});

test("the session start hook adds context only on resume", () => {
  const { carnet, root } = withSession();
  const base = { session_id: SESSION, cwd: root };
  expect(handleSessionStart(carnet, { ...base, source: "startup" }, {}).additionalContext).toBe(
    undefined,
  );
  const resumed = handleSessionStart(carnet, { ...base, source: "resume" }, {});
  expect(resumed.additionalContext).toContain("state when resumed");
});

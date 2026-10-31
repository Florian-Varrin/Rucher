import { expect, test } from "vite-plus/test";
import type { CarnetError } from "../src/index.ts";
import { SESSION, withSession } from "./helpers.ts";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as CarnetError).code;
  }
}

test("start, update, finish and drop follow the lifecycle and log events", () => {
  const { carnet } = withSession();
  const started = carnet.agents.start(SESSION, {
    name: "banner",
    task: "Add banner",
    baseCommit: "abc123",
  });
  expect(started).toMatchObject({ status: "running", baseCommit: "abc123", note: null });

  const updated = carnet.agents.update(SESSION, "banner", {
    status: "running",
    note: "see `src/x.ts` now",
  });
  expect(updated.note).toBe("see now");

  const finished = carnet.agents.finish(SESSION, "banner", {
    reportPath: "/tmp/banner.md",
    hasQuestions: true,
  });
  expect(finished).toMatchObject({ status: "answer", reportPath: "/tmp/banner.md" });

  const dropped = carnet.agents.drop(SESSION, "banner", "superseded");
  expect(dropped.status).toBe("closed");
  expect(carnet.agents.list(SESSION)).toEqual([]);

  const events = carnet.events.read(SESSION);
  expect(events.map((e) => [e.type, e.agent, e.link ?? e.note])).toEqual([
    ["started", "banner", "Add banner"],
    ["finished", "banner", "/tmp/banner.md"],
    ["dropped", "banner", "superseded"],
  ]);
});

test("finish without questions goes to review", () => {
  const { carnet } = withSession();
  carnet.agents.start(SESSION, { name: "dto", task: "dto" });
  expect(
    carnet.agents.finish(SESSION, "dto", { reportPath: "r.md", hasQuestions: false }).status,
  ).toBe("review");
});

test("an open name cannot be reused, a closed one can", () => {
  const { carnet } = withSession();
  carnet.agents.start(SESSION, { name: "banner", task: "v1" });
  expect(codeOf(() => carnet.agents.start(SESSION, { name: "banner", task: "v2" }))).toBe(
    "AGENT_EXISTS",
  );
  carnet.agents.drop(SESSION, "banner");
  expect(carnet.agents.start(SESSION, { name: "banner", task: "v2" }).task).toBe("v2");
  expect(carnet.events.read(SESSION).filter((e) => e.type === "started")).toHaveLength(2);
});

test("invalid statuses and unknown agents are rejected", () => {
  const { carnet } = withSession();
  expect(codeOf(() => carnet.agents.update(SESSION, "ghost", { status: "review" }))).toBe(
    "AGENT_NOT_FOUND",
  );
  carnet.agents.start(SESSION, { name: "a", task: "t" });
  expect(codeOf(() => carnet.agents.update(SESSION, "a", { status: "closed" }))).toBe(
    "INVALID_STATUS",
  );
  expect(codeOf(() => carnet.agents.update(SESSION, "a", { status: "bogus" as never }))).toBe(
    "INVALID_STATUS",
  );
  expect(codeOf(() => carnet.events.log(SESSION, { type: "bogus" as never }))).toBe(
    "INVALID_EVENT_TYPE",
  );
});

test("reorderQueue assigns positions to the named agents only", () => {
  const { carnet } = withSession();
  for (const name of ["a", "b", "c"]) carnet.agents.start(SESSION, { name, task: name });
  const agents = carnet.agents.reorderQueue(SESSION, ["c", "a"]);
  expect(agents.map((x) => [x.name, x.queueOrder])).toEqual([
    ["a", 2],
    ["b", null],
    ["c", 1],
  ]);
});

test("events.read returns the last N in chronological order", () => {
  const { carnet } = withSession();
  for (let i = 0; i < 5; i++) carnet.events.log(SESSION, { type: "committed", commit: `c${i}` });
  expect(carnet.events.read(SESSION, 2).map((e) => e.commit)).toEqual(["c3", "c4"]);
});

import { expect, test } from "vite-plus/test";
import { formatEvents, logOnce } from "../src/commands/log.ts";
import { makeCarnet, makeIo, SESSION } from "./helpers.ts";

test("formats events with time, type, agent, link and short commit", () => {
  const { carnet } = makeCarnet();
  carnet.agents.start(SESSION, { name: "banner", task: "Add banner" });
  carnet.events.log(SESSION, { type: "committed", agent: "banner", commit: "abcdef1234567" });
  const text = formatEvents(carnet.events.read(SESSION), makeIo());
  const lines = text.split("\n");
  expect(lines[0]).toMatch(/^\d\d:\d\d  started    banner  Add banner$/);
  expect(lines[1]).toMatch(/^\d\d:\d\d  committed  banner  abcdef1$/);
});

test("logOnce honours the count and reports an empty journal", () => {
  const { carnet } = makeCarnet();
  for (let i = 0; i < 3; i++) carnet.events.log(SESSION, { type: "tested", note: `n${i}` });
  const io = makeIo();
  logOnce(carnet, io, { count: 2 });
  expect(io.out.join("")).toMatch(/n1\n.*n2\n$/);
  const empty = makeCarnet();
  const io2 = makeIo();
  logOnce(empty.carnet, io2, { count: 5 });
  expect(io2.out.join("")).toBe("no events yet\n");
});

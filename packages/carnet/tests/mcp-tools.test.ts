import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { beforeAll, expect, test } from "vite-plus/test";
import type { Carnet } from "../src/index.ts";
import { createCarnetServer, INSTRUCTIONS, TOOLS } from "../src/mcp/index.ts";
import { makeCarnet, SESSION } from "./helpers.ts";

let carnet: Carnet;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text?: string }[])
    .map((c) => c.text ?? "")
    .join("\n");
  return { text, isError: result.isError === true, data: result.structuredContent };
}

beforeAll(async () => {
  const made = makeCarnet();
  carnet = made.carnet;
  const server = createCarnetServer({
    carnet,
    env: { CLAUDE_CODE_SESSION_ID: SESSION },
    cwd: made.root,
    ppid: 1,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
});

test("instructions fit Claude Code's limit and tools are listed", async () => {
  expect(INSTRUCTIONS.length).toBeLessThan(4096);
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
  const start = tools.find((t) => t.name === "agent_start");
  expect(start?.inputSchema).toMatchObject({ type: "object", required: ["name", "task"] });
});

test("main and fork lifecycle through the protocol", async () => {
  expect((await call("agent_start", { name: "banner", task: "Add banner" })).text).toBe(
    "⏳ banner started",
  );
  expect(
    (await call("agent_update", { name: "banner", status: "running", note: "halfway" })).text,
  ).toBe("⏳ banner — halfway");
  expect(
    (
      await call("agent_done", {
        name: "banner",
        report_path: "/tmp/banner.md",
        has_questions: true,
      })
    ).text,
  ).toBe("❓ banner needs answers");
  expect((await call("table_set", { text: "Step 1 — applying", main_working: true })).text).toBe(
    "⚙️ Step 1 — applying (main working, not ready)",
  );
  expect(
    (await call("log_event", { type: "committed", agent: "banner", commit: "abc123" })).text,
  ).toBe("logged committed banner abc123");

  const list = await call("agent_list");
  expect(list.text).toBe("❓ banner [answer] — halfway (report: /tmp/banner.md)");
  expect(list.data).toMatchObject({ agents: [{ name: "banner", status: "answer" }] });

  expect((await call("agent_drop", { name: "banner", reason: "merged" })).text).toBe(
    "banner closed",
  );
  expect((await call("agent_list")).text).toBe("no open agents");
  expect((await call("table_clear")).text).toBe("On the table cleared");

  expect(carnet.events.read(SESSION).map((e) => e.type)).toEqual([
    "started",
    "finished",
    "committed",
    "dropped",
  ]);
  expect(carnet.sessions.get(SESSION)?.status).toBe("temporary");
});

test("queue_reorder reports the waiting order", async () => {
  await call("agent_start", { name: "a", task: "t" });
  await call("agent_start", { name: "b", task: "t" });
  await call("agent_done", { name: "a", report_path: "a.md", has_questions: false });
  await call("agent_done", { name: "b", report_path: "b.md", has_questions: true });
  expect((await call("queue_reorder", { names: ["a"] })).text).toBe("Waiting order: a, b");
});

test("carnet errors come back as tool errors, validation errors too", async () => {
  const dup = await call("agent_start", { name: "a", task: "again" });
  expect(dup.isError).toBe(true);
  expect(dup.text).toContain("AGENT_EXISTS");
  const bad = await call("table_set", { text: "x", main_working: true, status: "review" });
  expect(bad.isError).toBe(true);
  expect(bad.text).toContain("TABLE_STATUS_WITH_MAIN_WORKING");
  const invalid = await call("agent_update", { name: "a", status: "closed" });
  expect(invalid.isError).toBe(true);
  expect(invalid.text).toContain("Input validation error");
});

test("an explicit session targets another session", async () => {
  const other = await call("agent_start", { name: "x", task: "t", session: "other-session" });
  expect(other.isError).toBe(false);
  expect(carnet.agents.list("other-session").map((a) => a.name)).toEqual(["x"]);
});

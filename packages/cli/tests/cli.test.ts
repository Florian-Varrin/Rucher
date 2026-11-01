import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { tempDir } from "./helpers.ts";

const bin = join(import.meta.dirname, "..", "dist", "cli.mjs");

test.skipIf(!existsSync(bin))("built binary runs help, init, hook and status", () => {
  const root = tempDir("meta-");
  mkdirSync(join(root, "api", ".git"), { recursive: true });
  const env = { ...process.env, RUCHER_HOME: tempDir("home-"), NO_COLOR: "1", CLAUDE_PID: "77" };
  const run = (args: string[], input?: string) =>
    execFileSync("node", [bin, ...args], { cwd: root, env, input, encoding: "utf8" });

  expect(run(["--help"])).toContain("status");
  expect(run(["init", "--name", "demo"])).toContain("demo initialised");
  run(["hook", "session-start"], JSON.stringify({ session_id: "s1", cwd: join(root, "api") }));
  const status = run(["status"]);
  expect(status).toContain("Waiting on you\n  nothing");
  expect(run(["log"])).toBe("no events yet\n");
});

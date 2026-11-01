import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { resumeTarget } from "../src/commands/resume.ts";
import { sessionsOnce } from "../src/commands/sessions.ts";
import { CliError } from "../src/session.ts";
import { makeCarnet, makeIo, SESSION } from "./helpers.ts";

test("sessions lists named sessions, --all adds temporary and dropped ones", () => {
  const { carnet } = makeCarnet();
  const io = makeIo();
  sessionsOnce(carnet, io);
  expect(io.out.join("")).toBe("no named session yet (temporary ones are hidden, use --all)\n");

  carnet.sessions.name(SESSION, "shop-auth", "Login flow");
  carnet.agents.start(SESSION, { name: "banner", task: "t" });
  carnet.sessions.ensure("other");
  carnet.sessions.name("other", "shop-cart");
  carnet.sessions.drop("other");
  carnet.sessions.ensure("temp-session");
  const now = new Date();
  const named = makeIo();
  sessionsOnce(carnet, named, { now });
  expect(named.out.join("")).toMatch(
    /^shop-auth {2}active {2}api {2}\S+ {2}1 agent {2}Login flow\n$/,
  );

  const all = makeIo();
  sessionsOnce(carnet, all, { all: true, now });
  const names = all.out
    .join("")
    .trimEnd()
    .split("\n")
    .map((l) => l.split(" ")[0]);
  expect(names.sort()).toEqual(["shop-auth", "shop-cart", "temp-ses"]);
});

test("resume targets claude --resume with the session id from its original cwd", () => {
  const { carnet, root } = makeCarnet();
  carnet.sessions.name(SESSION, "shop-auth");
  const io = makeIo();
  expect(resumeTarget(carnet, "shop-auth", io)).toEqual({
    command: "claude",
    args: ["--resume", SESSION],
    cwd: join(root, "api"),
  });
  expect(resumeTarget(carnet, SESSION, io).args).toEqual(["--resume", SESSION]);
  expect(io.err).toEqual([]);
});

test("resume falls back to the current directory, warns on dropped, refuses unknown", () => {
  const { carnet, root } = makeCarnet();
  const gone = join(root, "gone");
  mkdirSync(gone);
  carnet.sessions.upsertFromHook({ session_id: "s2", cwd: join(gone, "missing") });
  carnet.sessions.name("s2", "shop-old");
  carnet.sessions.drop("s2");
  const io = makeIo();
  expect(resumeTarget(carnet, "shop-old", io).cwd).toBe(io.cwd);
  expect(io.err.join("")).toBe("warning: session shop-old was dropped\n");
  expect(() => resumeTarget(carnet, "nope", io)).toThrowError(CliError);
});

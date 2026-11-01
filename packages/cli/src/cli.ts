#!/usr/bin/env node
import { CarnetError, openCarnet } from "@rucher/carnet";
import { defineCommand, runMain } from "citty";
import { sessionStart } from "./commands/hook.ts";
import { init } from "./commands/init.ts";
import { logOnce } from "./commands/log.ts";
import { serve } from "./commands/serve.ts";
import { statusOnce, statusWatch } from "./commands/status.ts";
import { type Io, processIo, readStdin } from "./io.ts";
import { CliError } from "./session.ts";

function fail(io: Io, error: unknown): never {
  if (error instanceof CliError) {
    io.stderr(`error: ${error.message}${error.hint ? `\n  ${error.hint}` : ""}\n`);
  } else if (error instanceof CarnetError) {
    io.stderr(`error: ${error.message}\n`);
  } else {
    io.stderr(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exit(1);
}

const colorArg = {
  color: { type: "boolean", default: true, description: "Colored output (--no-color to disable)" },
} as const;

const sessionArg = {
  session: {
    type: "string",
    alias: "s",
    description: "Session name or id (default: most recently active)",
  },
} as const;

const initCommand = defineCommand({
  meta: { name: "init", description: "Make the current directory a Rucher group (meta directory)" },
  args: {
    dir: {
      type: "positional",
      description: "Meta directory (default: current directory)",
      required: false,
    },
    name: { type: "string", description: "Group name (default: directory name)" },
    repos: { type: "string", description: "Comma-separated repo folders (default: detected)" },
    ...colorArg,
  },
  run({ args }) {
    const io = processIo({ color: args.color });
    const repos = args.repos
      ? args.repos
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean)
      : undefined;
    process.exitCode = init({ dir: args.dir, name: args.name, repos }, io);
  },
});

const statusCommand = defineCommand({
  meta: { name: "status", description: "Show agent statuses of a session" },
  args: {
    ...sessionArg,
    all: { type: "boolean", default: false, description: "Every session with activity" },
    watch: { type: "boolean", alias: "w", default: false, description: "Refresh continuously" },
    interval: {
      type: "string",
      default: "1",
      description: "Refresh interval in seconds with --watch",
    },
    ...colorArg,
  },
  async run({ args }) {
    const io = processIo({ color: args.color });
    try {
      const carnet = openCarnet({ cwd: io.cwd, env: io.env });
      const options = { session: args.session, all: args.all };
      if (!args.watch) {
        statusOnce(carnet, io, options);
        return;
      }
      const controller = new AbortController();
      process.on("SIGINT", () => controller.abort());
      process.on("SIGTERM", () => controller.abort());
      const intervalMs = Math.max(Number(args.interval) || 1, 0.2) * 1000;
      await statusWatch(carnet, io, { ...options, intervalMs, signal: controller.signal });
    } catch (error) {
      fail(io, error);
    }
  },
});

const logCommand = defineCommand({
  meta: { name: "log", description: "Show the last journal events of a session" },
  args: {
    ...sessionArg,
    count: { type: "string", alias: "n", default: "20", description: "Number of events" },
    ...colorArg,
  },
  run({ args }) {
    const io = processIo({ color: args.color });
    try {
      const carnet = openCarnet({ cwd: io.cwd, env: io.env });
      logOnce(carnet, io, { session: args.session, count: Number(args.count) || 20 });
    } catch (error) {
      fail(io, error);
    }
  },
});

const hookCommand = defineCommand({
  meta: { name: "hook", description: "Claude Code hook entry points (JSON payload on stdin)" },
  subCommands: {
    "session-start": defineCommand({
      meta: { name: "session-start", description: "SessionStart hook: records the session" },
      async run() {
        process.exitCode = sessionStart(await readStdin(), processIo());
      },
    }),
  },
});

const serveCommand = defineCommand({
  meta: { name: "serve", description: "Run the Carnet MCP server over stdio" },
  run() {
    serve(processIo());
  },
});

const main = defineCommand({
  meta: {
    name: "rucher",
    version: "0.0.0",
    description: "Status, journal and sessions of your Claude Code sub-agents",
  },
  subCommands: {
    init: initCommand,
    status: statusCommand,
    log: logCommand,
    hook: hookCommand,
    serve: serveCommand,
  },
});

void runMain(main);

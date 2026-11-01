#!/usr/bin/env node
import { CarnetError, openCarnet } from "@rucher/carnet";
import { defineCommand, runMain } from "citty";
import { groupAdd, groupRemove, groupShow, groupSync } from "./commands/group.ts";
import { groupsForget, groupsList, groupsPrune } from "./commands/groups.ts";
import { sessionStart, subagentStart, subagentStop } from "./commands/hook.ts";
import { init } from "./commands/init.ts";
import { logOnce } from "./commands/log.ts";
import { resumeTarget, runTarget } from "./commands/resume.ts";
import { serve } from "./commands/serve.ts";
import { sessionsOnce } from "./commands/sessions.ts";
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
    repos: {
      type: "string",
      description: "Comma-separated repo paths (more later with `rucher group add`)",
    },
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
    md: { type: "boolean", default: false, description: "Markdown output, for archiving" },
    ...colorArg,
  },
  run({ args }) {
    const io = processIo({ color: args.color });
    try {
      const carnet = openCarnet({ cwd: io.cwd, env: io.env });
      logOnce(carnet, io, {
        session: args.session,
        count: Number(args.count) || 20,
        md: args.md,
      });
    } catch (error) {
      fail(io, error);
    }
  },
});

const sessionsCommand = defineCommand({
  meta: { name: "sessions", description: "List the named sessions of the group" },
  args: {
    all: { type: "boolean", default: false, description: "Include temporary and dropped sessions" },
    ...colorArg,
  },
  run({ args }) {
    const io = processIo({ color: args.color });
    try {
      sessionsOnce(openCarnet({ cwd: io.cwd, env: io.env }), io, { all: args.all });
    } catch (error) {
      fail(io, error);
    }
  },
});

const resumeCommand = defineCommand({
  meta: { name: "resume", description: "Resume a named session in Claude Code" },
  args: {
    name: { type: "positional", description: "Session name or id", required: true },
  },
  run({ args }) {
    const io = processIo();
    try {
      const carnet = openCarnet({ cwd: io.cwd, env: io.env });
      const target = resumeTarget(carnet, args.name, io);
      carnet.close();
      process.exitCode = runTarget(target);
    } catch (error) {
      fail(io, error);
    }
  },
});

const groupCommand = defineCommand({
  meta: {
    name: "group",
    description: "Show the current group, add or remove repos, sync its settings",
  },
  subCommands: {
    show: defineCommand({
      meta: { name: "show", description: "Name, meta directory and repos of the current group" },
      args: { ...colorArg },
      run({ args }) {
        const io = processIo({ color: args.color });
        try {
          process.exitCode = groupShow(io);
        } catch (error) {
          fail(io, error);
        }
      },
    }),
    add: defineCommand({
      meta: { name: "add", description: "Add a repo path to the current group" },
      args: {
        path: { type: "positional", description: "Repo path", required: true },
        ...colorArg,
      },
      run({ args }) {
        const io = processIo({ color: args.color });
        try {
          process.exitCode = groupAdd(args.path, io);
        } catch (error) {
          fail(io, error);
        }
      },
    }),
    remove: defineCommand({
      meta: { name: "remove", description: "Remove a repo path from the current group" },
      args: {
        path: { type: "positional", description: "Repo path", required: true },
        ...colorArg,
      },
      run({ args }) {
        const io = processIo({ color: args.color });
        try {
          process.exitCode = groupRemove(args.path, io);
        } catch (error) {
          fail(io, error);
        }
      },
    }),
    sync: defineCommand({
      meta: {
        name: "sync",
        description: "Rewrite additionalDirectories and the CLAUDE.md repo list from group.json",
      },
      args: { ...colorArg },
      run({ args }) {
        const io = processIo({ color: args.color });
        try {
          process.exitCode = groupSync(io);
        } catch (error) {
          fail(io, error);
        }
      },
    }),
  },
});

const groupsCommand = defineCommand({
  meta: { name: "groups", description: "Registered groups of this machine" },
  subCommands: {
    list: defineCommand({
      meta: { name: "list", description: "Registered groups, missing ones flagged" },
      args: { ...colorArg },
      run({ args }) {
        process.exitCode = groupsList(processIo({ color: args.color }));
      },
    }),
    forget: defineCommand({
      meta: { name: "forget", description: "Unregister a group by name or meta directory path" },
      args: {
        ref: { type: "positional", description: "Group name or path", required: true },
        ...colorArg,
      },
      run({ args }) {
        process.exitCode = groupsForget(args.ref, processIo({ color: args.color }));
      },
    }),
    prune: defineCommand({
      meta: { name: "prune", description: "Unregister groups whose meta directory is gone" },
      args: { ...colorArg },
      run({ args }) {
        process.exitCode = groupsPrune(processIo({ color: args.color }));
      },
    }),
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
    "subagent-start": defineCommand({
      meta: {
        name: "subagent-start",
        description: "SubagentStart hook: pairs the fork with its agent",
      },
      async run() {
        process.exitCode = subagentStart(await readStdin(), processIo());
      },
    }),
    "subagent-stop": defineCommand({
      meta: {
        name: "subagent-stop",
        description: "SubagentStop hook: flags a fork that never called agent_done",
      },
      async run() {
        process.exitCode = subagentStop(await readStdin(), processIo());
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
    sessions: sessionsCommand,
    resume: resumeCommand,
    group: groupCommand,
    groups: groupsCommand,
    hook: hookCommand,
    serve: serveCommand,
  },
});

void runMain(main);

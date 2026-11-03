import { CarnetError, openCarnet } from '@rucher/carnet';
import { defineCommand } from 'citty';
import packageJson from '../package.json' with { type: 'json' };
import { groupAdd, groupRemove, groupShow, groupSync } from './commands/group.ts';
import { groupsForget, groupsList, groupsPrune } from './commands/groups.ts';
import {
  sessionEnd,
  sessionStart,
  subagentStart,
  subagentStop,
  userPromptSubmit,
} from './commands/hook.ts';
import { init } from './commands/init.ts';
import { logOnce } from './commands/log.ts';
import {
  notesAdd,
  notesDrop,
  notesList,
  notesShow,
  parseNoteId,
  repoList,
} from './commands/notes.ts';
import {
  finishLaunch,
  type LaunchPlan,
  planFork,
  planNew,
  planResume,
  positionals,
  spawnLaunch,
  splitPassthrough,
  startLaunch,
} from './commands/launch.ts';
import { pickSession } from './commands/picker.ts';
import { serve } from './commands/serve.ts';
import {
  sessionsClean,
  sessionsDemote,
  sessionsDrop,
  sessionsMerge,
  sessionsOnce,
  sessionsPromote,
  sessionsRename,
} from './commands/sessions.ts';
import { statusOnce, statusWatch } from './commands/status.ts';
import { type Io, processIo, readStdin } from './io.ts';
import { CliError } from './session.ts';

function fail(io: Io, error: unknown): never {
  if (error instanceof CliError) {
    io.stderr(`error: ${error.message}${error.hint ? `\n  ${error.hint}` : ''}\n`);
  } else if (error instanceof CarnetError) {
    io.stderr(`error: ${error.message}\n`);
  } else {
    io.stderr(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exit(1);
}

const colorArgument = {
  color: { type: 'boolean', default: true, description: 'Colored output (--no-color to disable)' },
} as const;

const sessionArgument = {
  session: {
    type: 'string',
    alias: 's',
    description: 'Session name, id or id prefix (default: most recently active)',
  },
} as const;

const initCommand = defineCommand({
  meta: { name: 'init', description: 'Make the current directory a Rucher group (meta directory)' },
  args: {
    directory: {
      type: 'positional',
      description: 'Meta directory (default: current directory)',
      required: false,
    },
    name: { type: 'string', description: 'Group name (default: directory name)' },
    repos: {
      type: 'string',
      description: 'Comma-separated repo paths (more later with `rucher group add`)',
    },
    ...colorArgument,
  },
  run({ args }) {
    const io = processIo({ color: args.color });
    const repos = args.repos
      ? args.repos
          .split(',')
          .map((repo) => repo.trim())
          .filter(Boolean)
      : undefined;
    process.exitCode = init({ directory: args.directory, name: args.name, repos }, io);
  },
});

const statusCommand = defineCommand({
  meta: { name: 'status', description: 'Show agent statuses of a session' },
  args: {
    ...sessionArgument,
    all: { type: 'boolean', default: false, description: 'Every session with activity' },
    watch: { type: 'boolean', alias: 'w', default: false, description: 'Refresh continuously' },
    interval: {
      type: 'string',
      default: '1',
      description: 'Refresh interval in seconds with --watch',
    },
    ...colorArgument,
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
      process.on('SIGINT', () => controller.abort());
      process.on('SIGTERM', () => controller.abort());
      const intervalMilliseconds = Math.max(Number(args.interval) || 1, 0.2) * 1000;
      await statusWatch(carnet, io, {
        ...options,
        intervalMilliseconds,
        signal: controller.signal,
      });
    } catch (error) {
      fail(io, error);
    }
  },
});

const logCommand = defineCommand({
  meta: { name: 'log', description: 'Show the last journal events of a session' },
  args: {
    ...sessionArgument,
    count: { type: 'string', alias: 'n', default: '20', description: 'Number of events' },
    md: { type: 'boolean', default: false, description: 'Markdown output, for archiving' },
    agents: {
      type: 'boolean',
      default: false,
      description: 'Agent events only, without session starts and ends',
    },
    ...colorArgument,
  },
  run({ args }) {
    const io = processIo({ color: args.color });
    try {
      const carnet = openCarnet({ cwd: io.cwd, env: io.env });
      logOnce(carnet, io, {
        session: args.session,
        count: Number(args.count) || 20,
        md: args.md,
        agents: args.agents,
      });
    } catch (error) {
      fail(io, error);
    }
  },
});

const sessionsListCommand = defineCommand({
  meta: { name: 'list', description: 'List the named sessions of the group' },
  args: {
    all: { type: 'boolean', default: false, description: 'Include temp and archived sessions' },
    ...colorArgument,
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

const sessionsMergeCommand = defineCommand({
  meta: {
    name: 'merge',
    description:
      'Move the agents, table line and journal of one session into another, then drop it',
  },
  args: {
    from: {
      type: 'positional',
      description: 'Session to empty (name, id or id prefix)',
      required: true,
    },
    into: {
      type: 'positional',
      description: 'Session that keeps everything (name, id or id prefix)',
      required: true,
    },
  },
  run({ args }) {
    const io = processIo();
    try {
      const carnet = openCarnet({ cwd: io.cwd, env: io.env });
      sessionsMerge(carnet, args.from, args.into, io);
      carnet.close();
    } catch (error) {
      fail(io, error);
    }
  },
});

const sessionReference = {
  type: 'positional',
  description: 'Session name, id or id prefix',
  required: true,
} as const;

const sessionsRenameCommand = defineCommand({
  meta: { name: 'rename', description: 'Rename a session that is not running' },
  args: {
    session: sessionReference,
    name: { type: 'positional', description: 'New name', required: true },
  },
  run({ args }) {
    const io = processIo();
    withCarnet(io, (carnet) => sessionsRename(carnet, args.session, args.name, io));
  },
});

const sessionsPromoteCommand = defineCommand({
  meta: { name: 'promote', description: 'Make a temp session active (a name is needed)' },
  args: {
    session: sessionReference,
    name: { type: 'positional', description: 'Name, when the session has none', required: false },
  },
  run({ args }) {
    const io = processIo();
    withCarnet(io, (carnet) => sessionsPromote(carnet, args.session, args.name, io));
  },
});

const sessionsDemoteCommand = defineCommand({
  meta: { name: 'demote', description: 'Make an active session temp, keeping its name' },
  args: { session: sessionReference },
  run({ args }) {
    const io = processIo();
    withCarnet(io, (carnet) => sessionsDemote(carnet, args.session, io));
  },
});

const purgeArgument = {
  purge: { type: 'boolean', default: false, description: 'Also delete the host transcript' },
} as const;

const sessionsDropCommand = defineCommand({
  meta: { name: 'drop', description: 'Archive a session and close its agents' },
  args: { session: sessionReference, ...purgeArgument },
  run({ args }) {
    const io = processIo();
    withCarnet(io, (carnet) => sessionsDrop(carnet, args.session, io, { purge: args.purge }));
  },
});

const sessionsCleanCommand = defineCommand({
  meta: {
    name: 'clean',
    description: 'Archive temp sessions idle for a while; reset running ones whose process is gone',
  },
  args: {
    'older-than': { type: 'string', default: '7d', description: 'Idle time: 30m, 12h, 7d' },
    ...purgeArgument,
    'dry-run': { type: 'boolean', default: false, description: 'Show what would be archived' },
  },
  run({ args }) {
    const io = processIo();
    withCarnet(io, (carnet) =>
      sessionsClean(carnet, io, {
        olderThan: args['older-than'],
        purge: args.purge,
        dryRun: args['dry-run'],
      }),
    );
  },
});

const sessionsCommand = defineCommand({
  meta: { name: 'sessions', description: 'List and manage the sessions of the group' },
  default: 'list',
  subCommands: {
    list: sessionsListCommand,
    merge: sessionsMergeCommand,
    rename: sessionsRenameCommand,
    promote: sessionsPromoteCommand,
    demote: sessionsDemoteCommand,
    drop: sessionsDropCommand,
    clean: sessionsCleanCommand,
  },
});

function withCarnet(io: Io, run: (carnet: ReturnType<typeof openCarnet>) => void): void {
  try {
    const carnet = openCarnet({ cwd: io.cwd, env: io.env });
    try {
      run(carnet);
    } finally {
      carnet.close();
    }
  } catch (error) {
    fail(io, error);
  }
}

const noteFilterArguments = {
  kind: { type: 'string', description: 'learning, decision or dead_end' },
  repo: { type: 'string', description: 'Only the notes of this repo' },
} as const;

const notesListCommand = defineCommand({
  meta: { name: 'list', description: 'Active notes of the group, by kind' },
  args: {
    all: { type: 'boolean', default: false, description: 'Include dropped notes and their reason' },
    ...noteFilterArguments,
    general: { type: 'boolean', default: false, description: 'Only the notes without repo' },
    stale: {
      type: 'boolean',
      default: false,
      description: 'Notes to review: old and never (or no longer) cited',
    },
    md: { type: 'boolean', default: false, description: 'Markdown output, a view only' },
    ...colorArgument,
  },
  run({ args }) {
    const io = processIo({ color: args.color });
    withCarnet(io, (carnet) =>
      notesList(carnet, io, {
        all: args.all,
        kind: args.kind,
        repo: args.repo,
        general: args.general,
        stale: args.stale,
        markdown: args.md,
      }),
    );
  },
});

const notesShowCommand = defineCommand({
  meta: { name: 'show', description: 'A note with its repos, weight and citations' },
  args: {
    id: { type: 'positional', description: 'Note id', required: true },
    ...colorArgument,
  },
  run({ args }) {
    const io = processIo({ color: args.color });
    withCarnet(io, (carnet) => notesShow(carnet, io, parseNoteId(args.id)));
  },
});

const notesAddCommand = defineCommand({
  meta: { name: 'add', description: 'Add a note by hand' },
  args: {
    kind: { type: 'positional', description: 'learning, decision or dead_end', required: true },
    text: { type: 'positional', description: 'One claim with its reason', required: true },
    repo: { type: 'string', description: 'Repo the note applies to (repeat for several)' },
    ...colorArgument,
  },
  run({ args, rawArgs }) {
    const io = processIo({ color: args.color });
    withCarnet(io, (carnet) =>
      notesAdd(carnet, io, { kind: args.kind, text: args.text, repos: repoList(rawArgs) }),
    );
  },
});

const notesDropCommand = defineCommand({
  meta: { name: 'drop', description: 'Close a note that proved wrong, keeping it in the history' },
  args: {
    id: { type: 'positional', description: 'Note id', required: true },
    reason: { type: 'string', description: 'Why it is no longer true', required: true },
    'replaced-by': { type: 'string', description: 'Id of the note that replaces it' },
  },
  run({ args }) {
    const io = processIo();
    const replacement = args['replaced-by'];
    withCarnet(io, (carnet) =>
      notesDrop(carnet, io, parseNoteId(args.id), {
        reason: args.reason,
        replacedBy: replacement === undefined ? undefined : parseNoteId(replacement),
      }),
    );
  },
});

const notesCommand = defineCommand({
  meta: { name: 'notes', description: "The group's memory: learnings, decisions and dead ends" },
  // Declared here too so `rucher notes --kind dead_end` reaches the default list command.
  args: noteFilterArguments,
  default: 'list',
  subCommands: {
    list: notesListCommand,
    show: notesShowCommand,
    add: notesAddCommand,
    drop: notesDropCommand,
  },
});

async function launch(
  io: Io,
  plan: (carnet: ReturnType<typeof openCarnet>) => LaunchPlan | Promise<LaunchPlan>,
): Promise<void> {
  try {
    const carnet = openCarnet({ cwd: io.cwd, env: io.env });
    const launchPlan = await plan(carnet);
    startLaunch(carnet, launchPlan);
    carnet.close();
    const exitCode = spawnLaunch(launchPlan, io.env);
    const after = openCarnet({ cwd: io.cwd, env: io.env });
    finishLaunch(after, launchPlan);
    after.close();
    process.exitCode = exitCode;
  } catch (error) {
    fail(io, error);
  }
}

const passthroughHelp = 'Arguments after -- are passed to Claude Code';

const newCommand = defineCommand({
  meta: { name: 'new', description: `Start a named, durable session. ${passthroughHelp}` },
  args: { name: { type: 'positional', description: 'Session name', required: true } },
  async run({ rawArgs }) {
    const { own, passthrough } = splitPassthrough(rawArgs);
    await launch(processIo(), (carnet) =>
      planNew(carnet, processIo(), { kind: 'active', name: positionals(own)[0], passthrough }),
    );
  },
});

const tmpCommand = defineCommand({
  meta: { name: 'tmp', description: `Start a temporary session. ${passthroughHelp}` },
  args: { name: { type: 'positional', description: 'Optional session name', required: false } },
  async run({ rawArgs }) {
    const { own, passthrough } = splitPassthrough(rawArgs);
    await launch(processIo(), (carnet) =>
      planNew(carnet, processIo(), { kind: 'temp', name: positionals(own)[0], passthrough }),
    );
  },
});

const resumeCommand = defineCommand({
  meta: {
    name: 'resume',
    description: `Resume a session in its host, or pick one when none is given. ${passthroughHelp}`,
  },
  args: {
    session: {
      type: 'positional',
      description: 'Session name, id or id prefix',
      required: false,
    },
  },
  async run({ rawArgs }) {
    const { own, passthrough } = splitPassthrough(rawArgs);
    const io = processIo();
    await launch(io, async (carnet) => {
      const reference = positionals(own)[0] ?? (await pickSession(carnet)).id;
      return planResume(carnet, io, reference, passthrough);
    });
  },
});

const forkCommand = defineCommand({
  meta: {
    name: 'fork',
    description: `Branch a session into a new one, temporary unless --active. ${passthroughHelp}`,
  },
  args: {
    session: { type: 'positional', description: 'Session to branch from', required: true },
    name: { type: 'positional', description: 'Name of the new session', required: false },
    active: {
      type: 'boolean',
      default: false,
      description: 'Make the new session durable (needs a name)',
    },
  },
  async run({ rawArgs }) {
    const { own, passthrough } = splitPassthrough(rawArgs);
    const [reference, name] = positionals(own);
    const io = processIo();
    await launch(io, (carnet) =>
      planFork(carnet, io, reference ?? '', {
        name,
        active: own.includes('--active'),
        passthrough,
      }),
    );
  },
});

const groupCommand = defineCommand({
  meta: {
    name: 'group',
    description: 'Show the current group, add or remove repos, sync its settings',
  },
  subCommands: {
    show: defineCommand({
      meta: { name: 'show', description: 'Name, meta directory and repos of the current group' },
      args: { ...colorArgument },
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
      meta: { name: 'add', description: 'Add a repo path to the current group' },
      args: {
        path: { type: 'positional', description: 'Repo path', required: true },
        ...colorArgument,
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
      meta: { name: 'remove', description: 'Remove a repo path from the current group' },
      args: {
        path: { type: 'positional', description: 'Repo path', required: true },
        ...colorArgument,
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
        name: 'sync',
        description:
          "Rewrite the hosts' context files (repo list, directory access) from group.json",
      },
      args: { ...colorArgument },
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
  meta: { name: 'groups', description: 'Registered groups of this machine' },
  subCommands: {
    list: defineCommand({
      meta: { name: 'list', description: 'Registered groups, missing ones flagged' },
      args: { ...colorArgument },
      run({ args }) {
        process.exitCode = groupsList(processIo({ color: args.color }));
      },
    }),
    forget: defineCommand({
      meta: { name: 'forget', description: 'Unregister a group by name or meta directory path' },
      args: {
        reference: { type: 'positional', description: 'Group name or path', required: true },
        ...colorArgument,
      },
      run({ args }) {
        process.exitCode = groupsForget(args.reference, processIo({ color: args.color }));
      },
    }),
    prune: defineCommand({
      meta: { name: 'prune', description: 'Unregister groups whose meta directory is gone' },
      args: { ...colorArgument },
      run({ args }) {
        process.exitCode = groupsPrune(processIo({ color: args.color }));
      },
    }),
  },
});

const hookCommand = defineCommand({
  meta: {
    name: 'hook',
    description: 'Agent host hook entry points (Claude Code, JSON payload on stdin)',
  },
  subCommands: {
    'session-start': defineCommand({
      meta: { name: 'session-start', description: 'SessionStart hook: records the session' },
      async run() {
        process.exitCode = sessionStart(await readStdin(), processIo());
      },
    }),
    'session-end': defineCommand({
      meta: { name: 'session-end', description: 'SessionEnd hook: marks the session idle' },
      async run() {
        process.exitCode = sessionEnd(await readStdin(), processIo());
      },
    }),
    'user-prompt-submit': defineCommand({
      meta: {
        name: 'user-prompt-submit',
        description: 'UserPromptSubmit hook: names the session after a /rename',
      },
      async run() {
        process.exitCode = userPromptSubmit(await readStdin(), processIo());
      },
    }),
    'subagent-start': defineCommand({
      meta: {
        name: 'subagent-start',
        description: 'SubagentStart hook: pairs the fork with its agent',
      },
      async run() {
        process.exitCode = subagentStart(await readStdin(), processIo());
      },
    }),
    'subagent-stop': defineCommand({
      meta: {
        name: 'subagent-stop',
        description: 'SubagentStop hook: flags a fork that never called agent_done',
      },
      async run() {
        process.exitCode = subagentStop(await readStdin(), processIo());
      },
    }),
  },
});

const serveCommand = defineCommand({
  meta: { name: 'serve', description: 'Run the Carnet MCP server over stdio' },
  run() {
    serve(processIo());
  },
});

export const main = defineCommand({
  meta: {
    name: 'rucher',
    version: packageJson.version,
    description: 'Status, journal and sessions of your coding agents (Claude Code today)',
  },
  subCommands: {
    init: initCommand,
    status: statusCommand,
    log: logCommand,
    new: newCommand,
    tmp: tmpCommand,
    resume: resumeCommand,
    fork: forkCommand,
    sessions: sessionsCommand,
    notes: notesCommand,
    group: groupCommand,
    groups: groupsCommand,
    hook: hookCommand,
    serve: serveCommand,
  },
});

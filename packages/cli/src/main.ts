import { CarnetError, type Carnet, openWorkspaceCarnet } from '@rucher/carnet';
import { defineCommand } from 'citty';
import packageJson from '../package.json' with { type: 'json' };
import {
  postToolUse,
  sessionEnd,
  sessionStart,
  subagentStart,
  subagentStop,
  userPromptSubmit,
} from './commands/hook.ts';
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
  sessionsMove,
  sessionsOnce,
  sessionsPromote,
  sessionsRename,
} from './commands/sessions.ts';
import { statusOnce, statusWatch } from './commands/status.ts';
import {
  workspaceAdd,
  workspaceCreate,
  workspaceDrop,
  workspaceEdit,
  workspaceErrors,
  workspaceList,
  workspacePath,
  workspaceRemove,
  workspaceShow,
  workspaceSync,
} from './commands/ws.ts';
import { type Io, processIo, readStdin } from './io.ts';
import { terminalKeys } from './terminal-keys.ts';
import { forwardWorkspace, openCliCarnet, workspaceArgument } from './workspace-option.ts';
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
    ...workspaceArgument,
    ...colorArgument,
  },
  async run({ args }) {
    const io = processIo({ color: args.color });
    try {
      const carnet = openCliCarnet(io, args.ws);
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
        keys: terminalKeys(process.stdin, process.stdout),
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
    ...workspaceArgument,
    ...colorArgument,
  },
  run({ args }) {
    const io = processIo({ color: args.color });
    try {
      const carnet = openCliCarnet(io, args.ws);
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
  meta: { name: 'list', description: 'List the named sessions of the workspace' },
  args: {
    all: { type: 'boolean', default: false, description: 'Include temp and archived sessions' },
    ...workspaceArgument,
    ...colorArgument,
  },
  run({ args }) {
    const io = processIo({ color: args.color });
    try {
      sessionsOnce(openCliCarnet(io, args.ws), io, { all: args.all });
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
    ...workspaceArgument,
  },
  run({ args }) {
    const io = processIo();
    try {
      const carnet = openCliCarnet(io, args.ws);
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
    ...workspaceArgument,
  },
  run({ args }) {
    const io = processIo();
    withCarnet(io, args.ws, (carnet) => sessionsRename(carnet, args.session, args.name, io));
  },
});

const sessionsPromoteCommand = defineCommand({
  meta: { name: 'promote', description: 'Make a temp session active (a name is needed)' },
  args: {
    session: sessionReference,
    name: { type: 'positional', description: 'Name, when the session has none', required: false },
    ...workspaceArgument,
  },
  run({ args }) {
    const io = processIo();
    withCarnet(io, args.ws, (carnet) => sessionsPromote(carnet, args.session, args.name, io));
  },
});

const sessionsDemoteCommand = defineCommand({
  meta: { name: 'demote', description: 'Make an active session temp, keeping its name' },
  args: { session: sessionReference, ...workspaceArgument },
  run({ args }) {
    const io = processIo();
    withCarnet(io, args.ws, (carnet) => sessionsDemote(carnet, args.session, io));
  },
});

const purgeArgument = {
  purge: { type: 'boolean', default: false, description: 'Also delete the host transcript' },
} as const;

const sessionsDropCommand = defineCommand({
  meta: { name: 'drop', description: 'Archive a session and close its agents' },
  args: { session: sessionReference, ...purgeArgument, ...workspaceArgument },
  run({ args }) {
    const io = processIo();
    withCarnet(io, args.ws, (carnet) =>
      sessionsDrop(carnet, args.session, io, { purge: args.purge }),
    );
  },
});

const sessionsMoveCommand = defineCommand({
  meta: {
    name: 'move',
    description: 'Move a session, its agents, table line and journal to another workspace',
  },
  args: {
    session: sessionReference,
    to: { type: 'string', required: true, description: 'Target workspace name' },
    merge: {
      type: 'boolean',
      default: false,
      description: 'Merge into the session the target workspace already has under this id or name',
    },
    'dry-run': { type: 'boolean', default: false, description: 'Show what would move' },
    ...workspaceArgument,
  },
  run({ args }) {
    const io = processIo();
    withCarnet(io, args.ws, (carnet) =>
      sessionsMove(carnet, args.session, args.to, io, {
        merge: args.merge,
        dryRun: args['dry-run'],
      }),
    );
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
    ...workspaceArgument,
  },
  run({ args }) {
    const io = processIo();
    withCarnet(io, args.ws, (carnet) =>
      sessionsClean(carnet, io, {
        olderThan: args['older-than'],
        purge: args.purge,
        dryRun: args['dry-run'],
      }),
    );
  },
});

const sessionsCommand = defineCommand({
  meta: { name: 'sessions', description: 'List and manage the sessions of the workspace' },
  args: { ...workspaceArgument },
  setup: forwardWorkspace,
  default: 'list',
  subCommands: {
    list: sessionsListCommand,
    merge: sessionsMergeCommand,
    move: sessionsMoveCommand,
    rename: sessionsRenameCommand,
    promote: sessionsPromoteCommand,
    demote: sessionsDemoteCommand,
    drop: sessionsDropCommand,
    clean: sessionsCleanCommand,
  },
});

function withCarnet(io: Io, workspace: string | undefined, run: (carnet: Carnet) => void): void {
  try {
    const carnet = openCliCarnet(io, workspace);
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
  meta: { name: 'list', description: 'Active notes of the workspace, by kind' },
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
    ...workspaceArgument,
    ...colorArgument,
  },
  run({ args }) {
    const io = processIo({ color: args.color });
    withCarnet(io, args.ws, (carnet) =>
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
    id: { type: 'positional', description: 'Note number', required: true },
    ...workspaceArgument,
    ...colorArgument,
  },
  run({ args }) {
    const io = processIo({ color: args.color });
    withCarnet(io, args.ws, (carnet) => notesShow(carnet, io, parseNoteId(args.id)));
  },
});

const notesAddCommand = defineCommand({
  meta: { name: 'add', description: 'Add a note by hand' },
  args: {
    kind: { type: 'positional', description: 'learning, decision or dead_end', required: true },
    text: { type: 'positional', description: 'One claim with its reason', required: true },
    repo: { type: 'string', description: 'Repo the note applies to (repeat for several)' },
    ...workspaceArgument,
    ...colorArgument,
  },
  run({ args, rawArgs }) {
    const io = processIo({ color: args.color });
    withCarnet(io, args.ws, (carnet) =>
      notesAdd(carnet, io, { kind: args.kind, text: args.text, repos: repoList(rawArgs) }),
    );
  },
});

const notesDropCommand = defineCommand({
  meta: { name: 'drop', description: 'Close a note that proved wrong, keeping it in the history' },
  args: {
    id: { type: 'positional', description: 'Note number', required: true },
    reason: { type: 'string', description: 'Why it is no longer true', required: true },
    'replaced-by': { type: 'string', description: 'Number of the note that replaces it' },
    ...workspaceArgument,
  },
  run({ args }) {
    const io = processIo();
    const replacement = args['replaced-by'];
    withCarnet(io, args.ws, (carnet) =>
      notesDrop(carnet, io, parseNoteId(args.id), {
        reason: args.reason,
        replacedBy: replacement === undefined ? undefined : parseNoteId(replacement),
      }),
    );
  },
});

const notesCommand = defineCommand({
  meta: {
    name: 'notes',
    description: "The workspace's memory: learnings, decisions and dead ends",
  },
  // Declared here too so `rucher notes --kind dead_end` reaches the default list command.
  args: { ...noteFilterArguments, ...workspaceArgument },
  setup: forwardWorkspace,
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
  workspace: string | undefined,
  plan: (carnet: Carnet) => LaunchPlan | Promise<LaunchPlan>,
): Promise<void> {
  try {
    const carnet = openCliCarnet(io, workspace);
    const launchPlan = await plan(carnet);
    startLaunch(carnet, launchPlan);
    carnet.close();
    const exitCode = spawnLaunch(launchPlan, io.env);
    // The same workspace as at launch, whatever the session's process did to the cwd.
    const after = openWorkspaceCarnet(carnet.workspace, { env: io.env });
    finishLaunch(after, launchPlan);
    after.close();
    process.exitCode = exitCode;
  } catch (error) {
    fail(io, error);
  }
}

const passthroughHelp = 'Arguments after -- are passed to Claude Code';

// The workspace option takes a value, which would otherwise read as a positional.
export function withoutWorkspaceOption(own: readonly string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < own.length; index += 1) {
    const argument = own[index] ?? '';
    if (argument === '--ws') index += 1;
    else if (!argument.startsWith('--ws=')) kept.push(argument);
  }
  return kept;
}

const newCommand = defineCommand({
  meta: { name: 'new', description: `Start a named, durable session. ${passthroughHelp}` },
  args: {
    name: { type: 'positional', description: 'Session name', required: true },
    ...workspaceArgument,
  },
  async run({ args, rawArgs }) {
    const { own, passthrough } = splitPassthrough(rawArgs);
    await launch(processIo(), args.ws, (carnet) =>
      planNew(carnet, processIo(), {
        kind: 'active',
        name: positionals(withoutWorkspaceOption(own))[0],
        passthrough,
      }),
    );
  },
});

const tmpCommand = defineCommand({
  meta: { name: 'tmp', description: `Start a temporary session. ${passthroughHelp}` },
  args: {
    name: { type: 'positional', description: 'Optional session name', required: false },
    ...workspaceArgument,
  },
  async run({ args, rawArgs }) {
    const { own, passthrough } = splitPassthrough(rawArgs);
    await launch(processIo(), args.ws, (carnet) =>
      planNew(carnet, processIo(), {
        kind: 'temp',
        name: positionals(withoutWorkspaceOption(own))[0],
        passthrough,
      }),
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
    ...workspaceArgument,
  },
  async run({ args, rawArgs }) {
    const { own, passthrough } = splitPassthrough(rawArgs);
    const io = processIo();
    await launch(io, args.ws, async (carnet) => {
      const reference =
        positionals(withoutWorkspaceOption(own))[0] ?? (await pickSession(carnet)).id;
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
    ...workspaceArgument,
  },
  async run({ args, rawArgs }) {
    const { own, passthrough } = splitPassthrough(rawArgs);
    const [reference, name] = positionals(withoutWorkspaceOption(own));
    const io = processIo();
    await launch(io, args.ws, (carnet) =>
      planFork(carnet, io, reference ?? '', {
        name,
        active: own.includes('--active'),
        passthrough,
      }),
    );
  },
});

async function askYes(question: string): Promise<boolean> {
  const { createInterface } = await import('node:readline/promises');
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return !/^n/i.test((await prompt.question(question)).trim());
  } finally {
    prompt.close();
  }
}

function commaList(value: string | undefined): string[] | undefined {
  return value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const wsCommand = defineCommand({
  meta: {
    name: 'ws',
    description:
      'The workspaces: create, list, show, add or remove repos, render, edit instructions',
  },
  args: { ...workspaceArgument },
  setup: forwardWorkspace,
  default: 'list',
  subCommands: {
    list: defineCommand({
      meta: { name: 'list', description: 'Workspaces with their repo and session counts' },
      args: { ...colorArgument },
      run({ args }) {
        process.exitCode = workspaceList(processIo({ color: args.color }));
      },
    }),
    create: defineCommand({
      meta: { name: 'create', description: 'Create a workspace and render its run directory' },
      args: {
        name: { type: 'positional', description: 'Workspace name: a-z, 0-9 and -', required: true },
        repos: { type: 'string', description: 'Comma-separated repo paths' },
        ...colorArgument,
      },
      run({ args }) {
        const io = processIo({ color: args.color });
        process.exitCode = workspaceErrors(io, () =>
          workspaceCreate(args.name, io, { repos: commaList(args.repos) }),
        );
      },
    }),
    drop: defineCommand({
      meta: {
        name: 'drop',
        description:
          'Archive the sessions of a workspace and remove its definition, keeping its notes',
      },
      args: {
        name: { type: 'positional', description: 'Workspace name', required: true },
        purge: {
          type: 'boolean',
          default: false,
          description: 'Also delete its notes and its run directory',
        },
      },
      run({ args }) {
        const io = processIo();
        process.exitCode = workspaceErrors(io, () =>
          workspaceDrop(args.name, io, { purge: args.purge }),
        );
      },
    }),
    show: defineCommand({
      meta: {
        name: 'show',
        description: 'Name, definition, run directory and repos of the workspace',
      },
      args: { ...workspaceArgument, ...colorArgument },
      run({ args }) {
        process.exitCode = workspaceShow(processIo({ color: args.color }), { workspace: args.ws });
      },
    }),
    add: defineCommand({
      meta: {
        name: 'add',
        description: 'Add a repo path to the workspace, then render its run directory',
      },
      args: {
        path: { type: 'positional', description: 'Repo path', required: true },
        ...workspaceArgument,
        ...colorArgument,
      },
      run({ args }) {
        process.exitCode = workspaceAdd(args.path, processIo({ color: args.color }), {
          workspace: args.ws,
        });
      },
    }),
    remove: defineCommand({
      meta: {
        name: 'remove',
        description: 'Remove a repo from the workspace, then render its run directory',
      },
      args: {
        path: { type: 'positional', description: 'Repo path or name', required: true },
        ...workspaceArgument,
        ...colorArgument,
      },
      run({ args }) {
        process.exitCode = workspaceRemove(args.path, processIo({ color: args.color }), {
          workspace: args.ws,
        });
      },
    }),
    sync: defineCommand({
      meta: {
        name: 'sync',
        description:
          "Render the workspace's run directory (instruction copies, generated settings)",
      },
      args: { ...workspaceArgument, ...colorArgument },
      run({ args }) {
        process.exitCode = workspaceSync(processIo({ color: args.color }), { workspace: args.ws });
      },
    }),
    edit: defineCommand({
      meta: {
        name: 'edit',
        description: 'Open the instructions (or workspace.json with --json) in $EDITOR, then sync',
      },
      args: {
        json: { type: 'boolean', default: false, description: 'Edit workspace.json instead' },
        ...workspaceArgument,
      },
      async run({ args }) {
        process.exitCode = await workspaceEdit(processIo(), {
          workspace: args.ws,
          json: args.json,
          confirm: askYes,
        });
      },
    }),
    path: defineCommand({
      meta: {
        name: 'path',
        description: 'Print the run directory path (or the definition with --def), for cd "$(...)"',
      },
      args: {
        def: { type: 'boolean', default: false, description: 'The definition folder instead' },
        run: { type: 'boolean', default: false, description: 'The run directory (default)' },
        ...workspaceArgument,
      },
      run({ args }) {
        process.exitCode = workspacePath(processIo(), { workspace: args.ws, definition: args.def });
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
    'post-tool-use': defineCommand({
      meta: {
        name: 'post-tool-use',
        description: "PostToolUse hook: adds a repo's notes the first time a tool touches it",
      },
      async run() {
        process.exitCode = postToolUse(await readStdin(), processIo());
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

// citty ignores unknown flags, so a removed one would act on the wrong workspace without a word.
export function refuseRemovedOption(rawArgs: readonly string[]): void {
  const removed = /^(-g|--group)(=|$)/;
  const option = splitPassthrough([...rawArgs]).own.find((argument) => removed.test(argument));
  if (option) fail(processIo(), new CliError(`Unknown option ${option}`, 'use --ws <name>'));
}

export const main = defineCommand({
  meta: {
    name: 'rucher',
    version: packageJson.version,
    description: 'Status, journal and sessions of your coding agents (Claude Code today)',
  },
  setup: ({ rawArgs }) => refuseRemovedOption(rawArgs),
  subCommands: {
    status: statusCommand,
    log: logCommand,
    new: newCommand,
    tmp: tmpCommand,
    resume: resumeCommand,
    fork: forkCommand,
    sessions: sessionsCommand,
    notes: notesCommand,
    ws: wsCommand,
    hook: hookCommand,
    serve: serveCommand,
  },
});

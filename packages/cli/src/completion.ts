import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Complete } from '@bomb.sh/tab';
import tab from '@bomb.sh/tab/citty';
import {
  workspaceRepoNames,
  listWorkspaces,
  NOTE_KINDS,
  openCarnet,
  resolveWorkspace,
  shortId,
} from '@rucher/carnet';
import type { CommandDef } from 'citty';

type Handler = (complete: Complete) => void;

export interface CompletionContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  typedWords: string[];
}

const hiddenCommands = new Set(['hook', 'serve']);

// Suggestions are printed on the shell line: any error must stay silent.
function quietly(suggest: () => void): void {
  try {
    suggest();
  } catch {}
}

// tab's parser takes `--ws=shop` for a flag expecting its value in the next word, so it never
// reaches the positional. The word under the cursor stays whole: tab completes `--ws=sh` itself.
export function splitInlineValues(words: string[]): string[] {
  return words.flatMap((word, index) => {
    const inline = index < words.length - 1 ? /^(--?[\w-]+)=(.*)$/.exec(word) : null;
    return inline ? [inline[1] as string, inline[2] as string] : [word];
  });
}

// The word under the cursor is left out: it is being completed, not chosen yet.
function readTypedWords({ typedWords }: CompletionContext) {
  const typed = typedWords.slice(0, -1);
  const passthrough = typed.indexOf('--');
  const own = passthrough === -1 ? typed : typed.slice(0, passthrough);
  const flag = own.lastIndexOf('--ws');
  const workspace = flag === -1 ? undefined : own[flag + 1];
  const words = own.filter((_, index) => !(index > 0 && own[index - 1] === '--ws'));
  return { workspace, words };
}

function inWorkspace(context: CompletionContext) {
  return { cwd: context.cwd, env: context.env, workspace: readTypedWords(context).workspace };
}

export function suggestSessions(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    const carnet = openCarnet(inWorkspace(context));
    try {
      const typed = readTypedWords(context).words;
      const sessions = carnet.sessions.list({ includeTemp: true });
      const suggestions = [
        ...sessions.flatMap((session) =>
          session.name
            ? [{ value: session.name, description: session.purpose ?? session.status }]
            : [],
        ),
        ...sessions.flatMap((session) =>
          session.name ? [] : [{ value: shortId(session.id), description: session.status }],
        ),
      ];
      for (const suggestion of suggestions) {
        if (!typed.includes(suggestion.value)) {
          complete(suggestion.value, suggestion.description);
        }
      }
    } finally {
      carnet.close();
    }
  });
}

export function suggestWorkspaces(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    for (const workspace of listWorkspaces(context.env))
      complete(workspace.name, workspace.runDirectory);
  });
}

export function suggestRepos(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    for (const repo of resolveWorkspace(inWorkspace(context)).workspace?.repos ?? []) {
      complete(repo.path, repo.name);
    }
  });
}

export function suggestRepoNames(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    const { workspace } = resolveWorkspace(inWorkspace(context));
    for (const repo of workspace ? workspaceRepoNames(workspace) : []) complete(repo, '');
  });
}

export function suggestNoteKinds(complete: Complete): void {
  for (const kind of NOTE_KINDS) complete(kind, '');
}

export function suggestNotes(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    const carnet = openCarnet(inWorkspace(context));
    try {
      for (const note of carnet.notes.list()) complete(String(note.id), note.text.slice(0, 60));
    } finally {
      carnet.close();
    }
  });
}

// tab always disables the shell's file completion, so directories are listed here.
export function suggestDirectories(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    const partial = context.typedWords.at(-1) ?? '';
    const base = partial.endsWith('/')
      ? partial
      : dirname(partial) === '.'
        ? ''
        : `${dirname(partial)}/`;
    for (const entry of readdirSync(resolve(context.cwd, base || '.'), { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) complete(join(base, entry.name), '');
    }
  });
}

function processContext(): CompletionContext {
  const separator = process.argv.indexOf('--');
  const typedWords = separator === -1 ? [] : splitInlineValues(process.argv.slice(separator + 1));
  return { cwd: process.cwd(), env: process.env, typedWords };
}

const sessions: Handler = (complete) => suggestSessions(processContext(), complete);
const workspaces: Handler = (complete) => suggestWorkspaces(processContext(), complete);
const repos: Handler = (complete) => suggestRepos(processContext(), complete);
const directories: Handler = (complete) => suggestDirectories(processContext(), complete);
const repoNames: Handler = (complete) => suggestRepoNames(processContext(), complete);
const noteKinds: Handler = (complete) => suggestNoteKinds(complete);
const notes: Handler = (complete) => suggestNotes(processContext(), complete);

const workspace = { ws: workspaces } as const;

export const completionConfig = {
  subCommands: {
    status: { options: { session: sessions, ...workspace } },
    log: { options: { session: sessions, ...workspace } },
    new: { options: workspace },
    tmp: { options: workspace },
    resume: { args: { session: sessions }, options: workspace },
    fork: { args: { session: sessions }, options: workspace },
    sessions: {
      options: workspace,
      subCommands: {
        list: { options: workspace },
        merge: { args: { from: sessions, into: sessions }, options: workspace },
        move: { args: { session: sessions }, options: { to: workspaces, ...workspace } },
        rename: { args: { session: sessions }, options: workspace },
        promote: { args: { session: sessions }, options: workspace },
        demote: { args: { session: sessions }, options: workspace },
        drop: { args: { session: sessions }, options: workspace },
        clean: { options: workspace },
      },
    },
    notes: {
      options: { kind: noteKinds, repo: repoNames, ...workspace },
      subCommands: {
        list: { options: { kind: noteKinds, repo: repoNames, ...workspace } },
        show: { args: { id: notes }, options: workspace },
        add: { args: { kind: noteKinds }, options: { repo: repoNames, ...workspace } },
        drop: { args: { id: notes }, options: { 'replaced-by': notes, ...workspace } },
      },
    },
    ws: {
      options: workspace,
      subCommands: {
        drop: { args: { name: workspaces } },
        show: { options: workspace },
        add: { args: { path: directories }, options: workspace },
        remove: { args: { path: repos }, options: workspace },
        sync: { options: workspace },
        edit: { options: workspace },
        path: { options: workspace },
      },
    },
  },
};

export const uncompletedArguments = [
  'status --interval',
  'log --count',
  'new name',
  'tmp name',
  'fork name',
  'notes add text',
  'notes drop --reason',
  'sessions rename name',
  'sessions promote name',
  'sessions clean --older-than',
  'ws create name',
  'ws create --repos',
];

export async function setupCompletion(main: CommandDef): Promise<void> {
  const subCommands = await (typeof main.subCommands === 'function'
    ? main.subCommands()
    : main.subCommands);
  const visible = Object.fromEntries(
    Object.entries(subCommands ?? {}).filter(([name]) => !hiddenCommands.has(name)),
  );
  // tab adds its `complete` command to the tree it walks; the walked copy hides internal commands.
  await tab({ ...main, subCommands: visible }, completionConfig);
  const complete = visible['complete'] as CommandDef | undefined;
  if (complete) {
    main.subCommands = {
      ...subCommands,
      complete: {
        ...complete,
        run: (context) => {
          context.rawArgs = splitInlineValues(context.rawArgs);
          return complete.run?.(context);
        },
      },
    };
  }
}

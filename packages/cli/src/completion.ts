import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Complete } from '@bomb.sh/tab';
import tab from '@bomb.sh/tab/citty';
import {
  groupRepoNames,
  locateGroup,
  NOTE_KINDS,
  openCarnet,
  readRegistry,
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

export function suggestSessions(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    const carnet = openCarnet(context);
    try {
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
        if (!context.typedWords.slice(0, -1).includes(suggestion.value)) {
          complete(suggestion.value, suggestion.description);
        }
      }
    } finally {
      carnet.close();
    }
  });
}

export function suggestGroups(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    const groups = readRegistry(context.env);
    for (const group of groups) {
      const shared = groups.filter((other) => other.name === group.name).length > 1;
      complete(shared ? group.path : group.name, group.path);
    }
  });
}

export function suggestRepos(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    for (const repo of locateGroup(context).repos) complete(repo, '');
  });
}

export function suggestRepoNames(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    for (const repo of groupRepoNames(locateGroup(context))) complete(repo, '');
  });
}

export function suggestNoteKinds(complete: Complete): void {
  for (const kind of NOTE_KINDS) complete(kind, '');
}

export function suggestNotes(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    const carnet = openCarnet(context);
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
  const typedWords = separator === -1 ? [] : process.argv.slice(separator + 1);
  return { cwd: process.cwd(), env: process.env, typedWords };
}

const sessions: Handler = (complete) => suggestSessions(processContext(), complete);
const groups: Handler = (complete) => suggestGroups(processContext(), complete);
const repos: Handler = (complete) => suggestRepos(processContext(), complete);
const directories: Handler = (complete) => suggestDirectories(processContext(), complete);
const repoNames: Handler = (complete) => suggestRepoNames(processContext(), complete);
const noteKinds: Handler = (complete) => suggestNoteKinds(complete);
const notes: Handler = (complete) => suggestNotes(processContext(), complete);

export const completionConfig = {
  subCommands: {
    status: { options: { session: sessions } },
    log: { options: { session: sessions } },
    init: { args: { directory: directories } },
    resume: { args: { session: sessions } },
    fork: { args: { session: sessions } },
    sessions: {
      subCommands: {
        merge: { args: { from: sessions, into: sessions } },
        move: { args: { session: sessions }, options: { to: groups } },
        rename: { args: { session: sessions } },
        promote: { args: { session: sessions } },
        demote: { args: { session: sessions } },
        drop: { args: { session: sessions } },
      },
    },
    notes: {
      options: { kind: noteKinds, repo: repoNames },
      subCommands: {
        list: { options: { kind: noteKinds, repo: repoNames } },
        show: { args: { id: notes } },
        add: { args: { kind: noteKinds }, options: { repo: repoNames } },
        drop: { args: { id: notes }, options: { 'replaced-by': notes } },
      },
    },
    groups: { subCommands: { forget: { args: { reference: groups } } } },
    group: {
      subCommands: { add: { args: { path: directories } }, remove: { args: { path: repos } } },
    },
  },
};

export const uncompletedArguments = [
  'init --name',
  'init --repos',
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
  const complete = visible['complete'];
  if (complete) main.subCommands = { ...subCommands, complete };
}

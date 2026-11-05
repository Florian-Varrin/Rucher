import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Complete } from '@bomb.sh/tab';
import tab from '@bomb.sh/tab/citty';
import {
  groupRepoNames,
  listGroups,
  NOTE_KINDS,
  openCarnet,
  resolveGroup,
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

// tab's parser takes `--group=shop` for a flag expecting its value in the next word, so it never
// reaches the positional. The word under the cursor stays whole: tab completes `--group=sh` itself.
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
  const flag = own.findLastIndex((word) => word === '-g' || word === '--group');
  const group = flag === -1 ? undefined : own[flag + 1];
  const words = own.filter(
    (_, index) => !(index > 0 && (own[index - 1] === '-g' || own[index - 1] === '--group')),
  );
  return { group, words };
}

function inGroup(context: CompletionContext) {
  return { cwd: context.cwd, env: context.env, group: readTypedWords(context).group };
}

export function suggestSessions(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    const carnet = openCarnet(inGroup(context));
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

export function suggestGroups(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    for (const group of listGroups(context.env)) complete(group.name, group.workspace);
  });
}

export function suggestRepos(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    for (const repo of resolveGroup(inGroup(context)).group?.repos ?? []) {
      complete(repo.path, repo.name);
    }
  });
}

export function suggestRepoNames(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    const { group } = resolveGroup(inGroup(context));
    for (const repo of group ? groupRepoNames(group) : []) complete(repo, '');
  });
}

export function suggestNoteKinds(complete: Complete): void {
  for (const kind of NOTE_KINDS) complete(kind, '');
}

export function suggestNotes(context: CompletionContext, complete: Complete): void {
  quietly(() => {
    const carnet = openCarnet(inGroup(context));
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
const groups: Handler = (complete) => suggestGroups(processContext(), complete);
const repos: Handler = (complete) => suggestRepos(processContext(), complete);
const directories: Handler = (complete) => suggestDirectories(processContext(), complete);
const repoNames: Handler = (complete) => suggestRepoNames(processContext(), complete);
const noteKinds: Handler = (complete) => suggestNoteKinds(complete);
const notes: Handler = (complete) => suggestNotes(processContext(), complete);

const group = { group: groups } as const;

export const completionConfig = {
  subCommands: {
    status: { options: { session: sessions, ...group } },
    log: { options: { session: sessions, ...group } },
    new: { options: group },
    tmp: { options: group },
    resume: { args: { session: sessions }, options: group },
    fork: { args: { session: sessions }, options: group },
    sessions: {
      options: group,
      subCommands: {
        list: { options: group },
        merge: { args: { from: sessions, into: sessions }, options: group },
        move: { args: { session: sessions }, options: { to: groups, ...group } },
        rename: { args: { session: sessions }, options: group },
        promote: { args: { session: sessions }, options: group },
        demote: { args: { session: sessions }, options: group },
        drop: { args: { session: sessions }, options: group },
        clean: { options: group },
      },
    },
    notes: {
      options: { kind: noteKinds, repo: repoNames, ...group },
      subCommands: {
        list: { options: { kind: noteKinds, repo: repoNames, ...group } },
        show: { args: { id: notes }, options: group },
        add: { args: { kind: noteKinds }, options: { repo: repoNames, ...group } },
        drop: { args: { id: notes }, options: { 'replaced-by': notes, ...group } },
      },
    },
    group: {
      subCommands: {
        show: { options: group },
        add: { args: { path: directories }, options: group },
        remove: { args: { path: repos }, options: group },
        sync: { options: group },
        edit: { options: group },
        path: { options: group },
      },
    },
    groups: {
      subCommands: {
        rename: { args: { from: groups } },
        drop: { args: { name: groups } },
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
  'groups create name',
  'groups create --repos',
  'groups rename to',
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

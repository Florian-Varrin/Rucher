import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { Group } from './group/group.ts';

export interface RucherPaths {
  config: string;
  data: string;
  state: string;
  run: string;
}

// The XDG spec says relative values must be ignored.
function xdgDirectory(value: string | undefined, fallback: string): string {
  return value && isAbsolute(value) ? value : fallback;
}

export function rucherPaths(env: NodeJS.ProcessEnv = process.env): RucherPaths {
  if (env.RUCHER_HOME) {
    const home = env.RUCHER_HOME;
    return {
      config: join(home, 'config'),
      data: join(home, 'data'),
      state: join(home, 'state'),
      run: join(home, 'run'),
    };
  }
  const home = env.HOME || homedir();
  const state = join(xdgDirectory(env.XDG_STATE_HOME, join(home, '.local', 'state')), 'rucher');
  return {
    config: join(xdgDirectory(env.XDG_CONFIG_HOME, join(home, '.config')), 'rucher'),
    data: join(xdgDirectory(env.XDG_DATA_HOME, join(home, '.local', 'share')), 'rucher'),
    state,
    run:
      env.XDG_RUNTIME_DIR && isAbsolute(env.XDG_RUNTIME_DIR)
        ? join(env.XDG_RUNTIME_DIR, 'rucher')
        : join(state, 'run'),
  };
}

export function databasePath(env?: NodeJS.ProcessEnv): string {
  return join(rucherPaths(env).data, 'carnet.db');
}

export function groupsDirectory(env?: NodeJS.ProcessEnv): string {
  return join(rucherPaths(env).config, 'groups');
}

export function groupDefinition(name: string, env?: NodeJS.ProcessEnv): string {
  return join(groupsDirectory(env), name);
}

export function defaultRunDirectory(name: string, env?: NodeJS.ProcessEnv): string {
  return join(rucherPaths(env).data, 'workspaces', name);
}

export function promptsDirectory(env?: NodeJS.ProcessEnv): string {
  return join(rucherPaths(env).state, 'prompts');
}

export function corePromptPath(env?: NodeJS.ProcessEnv): string {
  return join(rucherPaths(env).config, 'prompt.md');
}

export function reportsDirectory(group: Group): string {
  return join(group.runDirectory, 'reports');
}

export function reportPath(group: Group, agentName: string): string {
  return join(reportsDirectory(group), `${agentName}.md`);
}

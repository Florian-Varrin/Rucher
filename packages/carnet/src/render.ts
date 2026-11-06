import { mkdirSync } from 'node:fs';
import { type Group, groupHosts } from './group/group.ts';
import { hostById } from './hosts/host.ts';
import { reportsDirectory } from './paths.ts';

export interface RenderResult {
  runDirectory: string;
  written: string[];
  removed: string[];
}

export interface RunDirectoryRenderOptions {
  env?: NodeJS.ProcessEnv | undefined;
  host?: string | undefined;
}

export function renderRunDirectory(
  group: Group,
  options: RunDirectoryRenderOptions = {},
): RenderResult {
  mkdirSync(group.runDirectory, { recursive: true });
  mkdirSync(reportsDirectory(group), { recursive: true });
  const result: RenderResult = { runDirectory: group.runDirectory, written: [], removed: [] };
  for (const id of options.host ? [options.host] : groupHosts(group)) {
    const rendered = hostById(id).renderRunDirectory(group);
    result.written.push(...rendered.written);
    result.removed.push(...rendered.removed);
  }
  return result;
}

import { mkdirSync } from 'node:fs';
import { type Group, groupHosts } from './group/group.ts';
import { hostById } from './hosts/host.ts';
import { reportsDirectory } from './paths.ts';

export interface RenderResult {
  workspace: string;
  written: string[];
  linked: string[];
}

export interface WorkspaceRenderOptions {
  env?: NodeJS.ProcessEnv | undefined;
  host?: string | undefined;
}

export function renderWorkspace(group: Group, options: WorkspaceRenderOptions = {}): RenderResult {
  mkdirSync(group.workspace, { recursive: true });
  mkdirSync(reportsDirectory(group), { recursive: true });
  const result: RenderResult = { workspace: group.workspace, written: [], linked: [] };
  for (const id of options.host ? [options.host] : groupHosts(group)) {
    const rendered = hostById(id).renderWorkspace(group);
    result.written.push(...rendered.written);
    result.linked.push(...rendered.linked);
  }
  return result;
}

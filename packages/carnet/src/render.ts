import { mkdirSync } from 'node:fs';
import { type Workspace, workspaceHosts } from './workspace/workspace.ts';
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
  workspace: Workspace,
  options: RunDirectoryRenderOptions = {},
): RenderResult {
  mkdirSync(workspace.runDirectory, { recursive: true });
  mkdirSync(reportsDirectory(workspace), { recursive: true });
  const result: RenderResult = { runDirectory: workspace.runDirectory, written: [], removed: [] };
  for (const id of options.host ? [options.host] : workspaceHosts(workspace)) {
    const rendered = hostById(id).renderRunDirectory(workspace);
    result.written.push(...rendered.written);
    result.removed.push(...rendered.removed);
  }
  return result;
}

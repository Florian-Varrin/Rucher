import { basename } from 'node:path';
import type { Group } from '@rucher/carnet';

export const REPOS_START = '<!-- rucher:repos start -->';
export const REPOS_END = '<!-- rucher:repos end -->';

export function reposBlock(group: Group): string {
  const repos = group.repos.length
    ? group.repos.map((r) => `- \`${basename(r)}\`: ${r}`).join('\n')
    : '- (none yet: `rucher group add <path>`)';
  return `${REPOS_START}\n## Repos\n\n${repos}\n${REPOS_END}`;
}

export function replaceReposBlock(content: string, group: Group): string | null {
  const start = content.indexOf(REPOS_START);
  const end = content.indexOf(REPOS_END);
  if (start === -1 || end === -1 || end < start) return null;
  return content.slice(0, start) + reposBlock(group) + content.slice(end + REPOS_END.length);
}

export function groupClaudeMd(group: Group): string {
  return `# ${group.name}

Meta directory of the ${group.name} group: context only, the repos live at their own paths below and are reachable through \`.claude/settings.json\`. Start Claude sessions here.

${reposBlock(group)}

## Multi-agent work

Use the rucher tools (Carnet) for agent statuses and the journal, and the rucher skill for the workflow.

## Shared instructions

(what every session of this group should know)
`;
}

export function groupSettings(group: Group): string {
  return `${JSON.stringify({ permissions: { additionalDirectories: group.repos } }, null, 2)}\n`;
}

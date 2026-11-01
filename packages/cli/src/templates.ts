import type { Group } from "@rucher/carnet";

export function groupClaudeMd(group: Group): string {
  const repos = group.repos.length
    ? group.repos.map((r) => `- \`${r}/\``).join("\n")
    : "- (no repo detected yet)";
  return `# ${group.name}

Meta directory for the ${group.name} group. Claude sessions start here or inside one of the repos below.

## Repos

${repos}

## Multi-agent work

Use the rucher tools (Carnet) for agent statuses and the journal, and the rucher skill for the workflow.

## Shared instructions

(what every session of this group should know)
`;
}

export function groupSettings(group: Group): string {
  const dirs = group.repos.map((r) => `./${r}`);
  return `${JSON.stringify({ permissions: { additionalDirectories: dirs } }, null, 2)}\n`;
}

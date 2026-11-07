export const ISSUE_REPOSITORY = "Leon-Achteresch/l8db";
export const ISSUE_FOOTER = "Automatisch aus l8db gemeldet.";
export const ISSUE_LABELS = [
  { name: "bug", color: "d73a4a", dark: true },
  { name: "ai-report", color: "ededed", dark: false },
];

export function githubIssueUrl(output: string): string | undefined {
  return output
    .match(/(?:^|\s)https:\/\/github\.com\/Leon-Achteresch\/l8db\/issues\/[1-9]\d*(?=\s|$)/)?.[0]
    .trim();
}

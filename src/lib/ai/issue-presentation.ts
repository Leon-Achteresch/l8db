export function githubIssueUrl(output: string): string | undefined {
  return output
    .match(/(?:^|\s)https:\/\/github\.com\/Leon-Achteresch\/l8db\/issues\/[1-9]\d*(?=\s|$)/)?.[0]
    .trim();
}

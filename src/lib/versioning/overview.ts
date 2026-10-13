import { categoryCounts, findTickets, type TicketConfiguration } from "./review";
import type { DatabaseRelease, DatabaseTarget, RepositoryStatus, VersioningProject } from "./types";
import { customerGroups, progressIndex, targetProgress } from "./workflow";

export function recentCommits(history: string | undefined, limit = 6) {
  return (history ?? "")
    .split("\n")
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => {
      const [hash, ...subject] = line.split("\t");
      return { hash, subject: subject.join("\t") };
    });
}

export function overviewModel(
  project: VersioningProject | null,
  status: RepositoryStatus | null,
  releases: DatabaseRelease[],
  targets: DatabaseTarget[],
  tickets: TicketConfiguration,
) {
  const index = progressIndex(releases, status);
  let pending = 0;
  let blocked = 0;
  for (const target of targets) {
    const progress = targetProgress(target, releases, status, index);
    if (progress.pending) pending++;
    if (progress.state === "blocked" || progress.state === "baseline") blocked++;
  }
  return {
    schema: categoryCounts(project),
    objects: project?.objects.length ?? 0,
    commits: recentCommits(status?.history).map((commit) => ({
      ...commit,
      tickets: findTickets([commit.subject], tickets),
    })),
    customers: customerGroups(targets).length,
    environments: targets.length,
    pending,
    blocked,
    latest: releases.at(-1)?.id ?? null,
    branches: status?.branches.length ?? 0,
  };
}

import { lineStatus } from "./change-plan";
import type { DatabaseRelease, RepositoryStatus, TargetStore } from "./types";

export function changedFiles(changes: string): Map<string, string> {
  const result = new Map<string, string>();
  const entries = changes.split("\0");
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    result.set(entry.slice(3), status.trim());
    if (/[RC]/.test(status)) index++;
  }
  return result;
}

export function pendingVersioningCount(
  status: RepositoryStatus | null,
  releases: DatabaseRelease[],
  targets: TargetStore | null,
  dirty: boolean,
): number {
  const files = changedFiles(status?.changes ?? "");
  const available = new Map(
    releases
      .filter((release) => !files.has(`database/releases/${release.id}.json`))
      .map((release) => [release.id, release]),
  );
  const pending =
    targets?.targets.filter((target) => {
      if (
        !target.release ||
        target.history.some((event) => event.status === "failed" || event.status === "running")
      )
        return true;
      if (target.paused) return false;
      return (
        lineStatus(available, target.track ?? "main", target.pinnedRelease, target.release.id)
          .pending > 0
      );
    }).length ?? 0;
  return files.size + pending + Number(dirty);
}

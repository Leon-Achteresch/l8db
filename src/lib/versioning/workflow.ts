import { activeVariances, lineStatus } from "./change-plan";
import { releaseParents, releasePath } from "./model";
import { changedFiles } from "./status";
import type { DatabaseRelease, DatabaseTarget, RepositoryStatus } from "./types";

export type VersioningArea =
  | "overview"
  | "pipeline"
  | "history"
  | "development"
  | "branches"
  | "releases"
  | "targets"
  | "reviews"
  | "seeds"
  | "activity";

export function progressIndex(releases: DatabaseRelease[], status: RepositoryStatus | null) {
  const changes = changedFiles(status?.changes ?? "");
  const available = new Map(
    releases
      .filter((release) => status?.head && !changes.has(releasePath(release.id)))
      .map((release) => [release.id, release]),
  );
  const children = new Map<string, DatabaseRelease[]>();
  for (const release of available.values())
    for (const parent of releaseParents(release)) {
      const siblings = children.get(parent);
      if (siblings) siblings.push(release);
      else children.set(parent, [release]);
    }
  return {
    available,
    children,
    pending: new Map<string, { pending: number; tip: string | null }>(),
  };
}

export type ProgressIndex = ReturnType<typeof progressIndex>;

export function ledgerOpen(target: DatabaseTarget, tip: string | null) {
  const ledger = target.ledger;
  if (!ledger || !tip || ledger.tip !== tip) return null;
  const stale = target.history.some(
    (event) => (event.finishedAt ?? event.startedAt) > ledger.checkedAt,
  );
  return stale ? null : ledger.open;
}

export function targetProgress(
  target: DatabaseTarget,
  releases: DatabaseRelease[],
  status: RepositoryStatus | null,
  index: ProgressIndex = progressIndex(releases, status),
) {
  const variances = activeVariances(target.variances).length;
  const base = { pending: 0, open: null as number | null, variances };
  if (target.history.some((event) => event.status === "running" || event.status === "failed"))
    return { ...base, label: "Stand abgleichen", state: "blocked" as const };
  if (!target.connectionId)
    return { ...base, label: "Lokales Profil zuordnen", state: "blocked" as const };
  if (!target.release) return { ...base, label: "Baseline prüfen", state: "baseline" as const };
  if (target.paused) return { ...base, label: "Updates pausiert", state: "paused" as const };
  const { available } = index;
  const track = target.track ?? "main";
  const key = `${target.release.id}\0${track}\0${target.pinnedRelease ?? ""}`;
  let line = index.pending.get(key);
  if (line === undefined) {
    const status = lineStatus(available, track, target.pinnedRelease, target.release.id);
    line = { pending: status.diverged ? -1 : status.pending, tip: status.tip?.id ?? null };
    index.pending.set(key, line);
  }
  if (line.pending < 0) return { ...base, label: "Merge-Release nötig", state: "blocked" as const };
  const open = ledgerOpen(target, line.tip);
  const pending = open ? Math.max(line.pending, 1) : line.pending;
  return {
    ...base,
    open,
    label: pending ? `${pending} ${pending === 1 ? "Update" : "Updates"} offen` : "Aktuell",
    pending,
    state: pending ? ("pending" as const) : ("current" as const),
  };
}

export function ledgerDetail(progress: { open: number | null; variances: number }) {
  return [
    progress.open ? `${progress.open} ${progress.open === 1 ? "Änderung" : "Änderungen"}` : "",
    progress.variances
      ? `${progress.variances} ${progress.variances === 1 ? "Abweichung" : "Abweichungen"}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function customerGroups(targets: DatabaseTarget[]) {
  const groups = new Map<string, DatabaseTarget[]>();
  for (const target of targets) {
    const customer = target.customer?.trim() || target.name;
    groups.set(customer, [...(groups.get(customer) ?? []), target]);
  }
  return [...groups].map(([customer, targets]) => ({ customer, targets }));
}

export function connectionServerLabel(connectionString: string | undefined) {
  if (!connectionString) return "";
  try {
    return new URL(connectionString).host;
  } catch {
    return "";
  }
}

export interface GitGraphCommit {
  id: string;
  parents: string[];
  refs: string;
  date: string;
  subject: string;
}

export function parseGitGraph(text: string): GitGraphCommit[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, parents, refs, date, ...subject] = line.split("\t");
      return {
        id,
        parents: parents ? parents.split(" ") : [],
        refs,
        date,
        subject: subject.join("\t"),
      };
    })
    .filter((commit) => /^[a-f0-9]{40,64}$/.test(commit.id));
}

export function graphLanes(commits: GitGraphCommit[]) {
  const lanes: string[] = [];
  return commits.map((commit) => {
    if (!lanes.includes(commit.id)) lanes.push(commit.id);
    const before = [...lanes];
    const lane = lanes.indexOf(commit.id);
    lanes.splice(lane, 1);
    for (const [index, parent] of commit.parents.entries()) {
      if (!lanes.includes(parent)) lanes.splice(Math.min(lane + index, lanes.length), 0, parent);
    }
    return {
      commit,
      lane,
      width: Math.max(before.length, lanes.length, 1),
      edges: before.flatMap((id, from) => {
        const destinations = id === commit.id ? commit.parents : [id];
        return destinations.flatMap((id) => {
          const to = lanes.indexOf(id);
          return to < 0 ? [] : [{ from, to, parent: id, active: from === lane }];
        });
      }),
    };
  });
}

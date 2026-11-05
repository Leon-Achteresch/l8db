import { lineStatus } from "./change-plan";
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
  return { available, children, pending: new Map<string, number>() };
}

export type ProgressIndex = ReturnType<typeof progressIndex>;

export function targetProgress(
  target: DatabaseTarget,
  releases: DatabaseRelease[],
  status: RepositoryStatus | null,
  index: ProgressIndex = progressIndex(releases, status),
) {
  if (target.history.some((event) => event.status === "running" || event.status === "failed"))
    return { label: "Stand abgleichen", pending: 0, state: "blocked" as const };
  if (!target.connectionId)
    return { label: "Lokales Profil zuordnen", pending: 0, state: "blocked" as const };
  if (!target.release) return { label: "Baseline prüfen", pending: 0, state: "baseline" as const };
  if (target.paused) return { label: "Updates pausiert", pending: 0, state: "paused" as const };
  const { available } = index;
  const track = target.track ?? "main";
  const key = `${target.release.id}\0${track}\0${target.pinnedRelease ?? ""}`;
  let pending = index.pending.get(key);
  if (pending === undefined) {
    const line = lineStatus(available, track, target.pinnedRelease, target.release.id);
    pending = line.diverged ? -1 : line.pending;
    if (line.tip && target.ledger?.tip === line.tip.id && target.ledger.open)
      pending = Math.max(pending, 1);
    index.pending.set(key, pending);
  }
  if (pending < 0)
    return {
      label: "Merge-Release nötig",
      pending: 0,
      state: "blocked" as const,
    };
  return {
    label: pending ? `${pending} ${pending === 1 ? "Update" : "Updates"} offen` : "Aktuell",
    pending,
    state: pending ? ("pending" as const) : ("current" as const),
  };
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

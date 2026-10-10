import { releasePath, releaseTrack } from "./model";
import { changedFiles } from "./status";
import type { DatabaseRelease, DatabaseTarget, RepositoryStatus } from "./types";

export type VersioningArea =
  | "pipeline"
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
    if (release.parent)
      children.set(release.parent, [...(children.get(release.parent) ?? []), release]);
  return { available, children };
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
  const { available, children } = index;
  const allowed = new Set<string>();
  let pinned = target.pinnedRelease;
  while (pinned && !allowed.has(pinned)) {
    allowed.add(pinned);
    pinned = available.get(pinned)?.parent;
  }
  const track = target.track ?? "main";
  let pending = 0;
  const seen = new Set<string>([target.release.id]);
  let level = children.get(target.release.id) ?? [];
  for (let depth = 1; level.length; depth++) {
    const next: DatabaseRelease[] = [];
    for (const release of level) {
      if (seen.has(release.id)) continue;
      seen.add(release.id);
      if (releaseTrack(release) === track && (!target.pinnedRelease || allowed.has(release.id)))
        pending = depth;
      next.push(...(children.get(release.id) ?? []));
    }
    level = next;
  }
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

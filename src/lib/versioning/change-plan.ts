import { releaseAncestry, releaseParents, releaseTrack } from "./model";
import type {
  AppliedChange,
  Change,
  DatabaseRelease,
  ObjectSnapshot,
  StandaloneChange,
  Variance,
} from "./types";

export const embeddedChangeId = (release: string, migration: string) => `${release}/${migration}`;

const derivedMemo = new WeakMap<
  DatabaseRelease,
  { parent: DatabaseRelease | undefined; value: ReturnType<typeof computeTouches> }
>();

export function derivedTouches(release: DatabaseRelease, parent: DatabaseRelease | undefined) {
  const known = derivedMemo.get(release);
  if (known && known.parent === parent) return known.value;
  const value = computeTouches(release, parent);
  derivedMemo.set(release, { parent, value });
  return value;
}

function computeTouches(
  release: DatabaseRelease,
  parent: DatabaseRelease | undefined,
): { touches: string[]; before: Record<string, string | null> } {
  const previous = new Map((parent?.objects ?? []).map((entry) => [entry.object.id, entry]));
  const current = new Map(release.objects.map((entry) => [entry.object.id, entry]));
  const touches: string[] = [];
  const before: Record<string, string | null> = {};
  for (const id of new Set([...previous.keys(), ...current.keys()])) {
    const old = previous.get(id);
    if (old?.checksum === current.get(id)?.checksum) continue;
    touches.push(id);
    before[id] = old?.checksum ?? null;
  }
  return { touches, before };
}

export function standaloneChange(id: string, change: StandaloneChange): Change {
  return {
    id,
    release: null,
    title: change.title,
    sql: change.sql,
    checksum: change.checksum,
    kind: change.kind ?? "versioned",
    touches: change.touches,
    before: change.before ?? {},
    requires: change.requires ?? [],
    data: change.data ?? false,
    destructive: change.destructive ?? false,
    preconditions: change.preconditions ?? [],
    postconditions: change.postconditions ?? [],
  };
}

export function releaseChanges(
  release: DatabaseRelease,
  map: Map<string, DatabaseRelease>,
  standalone: Map<string, StandaloneChange>,
): Change[] {
  const changes: Change[] = [];
  for (const id of release.changes ?? []) {
    const change = standalone.get(id);
    if (!change)
      throw new Error(`Änderung ${id} aus Release ${release.id} fehlt unter database/changes/.`);
    changes.push(standaloneChange(id, change));
  }
  let derived: ReturnType<typeof derivedTouches> | undefined;
  for (const migration of release.migrations) {
    const explicit = migration.touches !== undefined;
    derived ??= explicit
      ? undefined
      : derivedTouches(release, map.get(releaseParents(release)[0] ?? ""));
    const touches = migration.touches ?? derived?.touches ?? [];
    changes.push({
      id: embeddedChangeId(release.id, migration.id),
      release: release.id,
      title: migration.title,
      sql: migration.sql,
      checksum: migration.checksum,
      kind: migration.kind ?? "versioned",
      touches,
      before: explicit ? (migration.before ?? {}) : (derived?.before ?? {}),
      requires: migration.requires ?? [],
      data: migration.data ?? (!explicit && touches.length === 0),
      destructive: migration.destructive ?? false,
      preconditions: migration.preconditions ?? [],
      postconditions: migration.postconditions ?? [],
    });
  }
  return changes;
}

export interface ReleaseClosure {
  releases: DatabaseRelease[];
  changes: Change[];
  owner: Map<string, string>;
}

export function releaseClosure(
  map: Map<string, DatabaseRelease>,
  id: string,
  standalone: Map<string, StandaloneChange> = new Map(),
): ReleaseClosure {
  const releases = releaseAncestry(map, id);
  const changes: Change[] = [];
  const owner = new Map<string, string>();
  const checksums = new Map<string, string>();
  for (const release of releases)
    for (const change of releaseChanges(release, map, standalone)) {
      const known = checksums.get(change.id);
      if (known !== undefined) {
        if (known !== change.checksum)
          throw new Error(`Änderung ${change.id} ist in zwei Releases unterschiedlich.`);
        continue;
      }
      checksums.set(change.id, change.checksum);
      owner.set(change.id, release.id);
      changes.push(change);
    }
  return { releases, changes, owner };
}

export interface PlannedStep {
  release: DatabaseRelease;
  changes: Change[];
}

export interface ChangePlan {
  closure: ReleaseClosure;
  open: Change[];
  steps: PlannedStep[];
  touched: Set<string>;
}

export function aheadObjects(
  plan: Pick<ChangePlan, "closure" | "touched">,
  applied: Map<string, AppliedChange>,
  standalone: Map<string, StandaloneChange>,
) {
  const closureIds = new Set(plan.closure.changes.map((change) => change.id));
  return [...applied.keys()]
    .filter((id) => !closureIds.has(id) && standalone.has(id))
    .flatMap((id) => (standalone.get(id)?.touches ?? []).map((object) => ({ object, change: id })))
    .filter((entry) => !plan.touched.has(entry.object));
}

export function planChanges(
  map: Map<string, DatabaseRelease>,
  targetId: string,
  applied: Map<string, AppliedChange>,
  currentRelease: string | null,
  standalone: Map<string, StandaloneChange> = new Map(),
): ChangePlan {
  const closure = releaseClosure(map, targetId, standalone);
  for (const change of closure.changes) {
    const done = applied.get(change.id);
    if (done && done.checksum !== change.checksum)
      throw new Error(
        `Die bereits angewendete Änderung ${change.id} wurde im Repository verändert. Neue Änderung anlegen statt die alte zu bearbeiten.`,
      );
  }
  const open = closure.changes.filter((change) => !applied.has(change.id));
  const grouped = new Map<string, Change[]>();
  for (const change of open) {
    const release = closure.owner.get(change.id) ?? targetId;
    grouped.set(release, [...(grouped.get(release) ?? []), change]);
  }
  const position = new Map<string, number>();
  const steps: PlannedStep[] = [];
  for (const release of closure.releases) {
    const changes = grouped.get(release.id);
    const last = release.id === targetId;
    if (!changes && !(last && (open.length || currentRelease !== targetId))) continue;
    const ordered = orderStep(changes ?? [], applied, position, steps.length);
    for (const change of ordered) position.set(change.id, steps.length);
    steps.push({ release, changes: ordered });
  }
  const touched = new Set(open.flatMap((change) => change.touches));
  return { closure, open, steps, touched };
}

function orderStep(
  changes: Change[],
  applied: Map<string, AppliedChange>,
  position: Map<string, number>,
  step: number,
) {
  const pending = new Map(changes.map((change) => [change.id, change]));
  const result: Change[] = [];
  const placed = new Set<string>();
  while (pending.size) {
    let progressed = false;
    for (const change of pending.values()) {
      const ready = change.requires.every((id) => {
        if (applied.has(id) || placed.has(id)) return true;
        const earlier = position.get(id);
        if (earlier !== undefined && earlier < step) return true;
        if (pending.has(id)) return false;
        throw new Error(
          `Änderung ${change.id} benötigt ${id}, die weder angewendet noch geplant ist.`,
        );
      });
      if (!ready) continue;
      result.push(change);
      placed.add(change.id);
      pending.delete(change.id);
      progressed = true;
    }
    if (!progressed) throw new Error("Zyklische Abhängigkeit zwischen Änderungen.");
  }
  return result;
}

export function objectHistory(releases: Iterable<DatabaseRelease>) {
  const definitions = new Map<string, ObjectSnapshot>();
  for (const release of releases)
    for (const entry of release.objects)
      definitions.set(`${entry.object.id}\0${entry.checksum}`, entry);
  return (id: string, hash: string) => definitions.get(`${id}\0${hash}`);
}

export function pendingReleases(
  map: Map<string, DatabaseRelease>,
  from: string,
  tip: string,
): number {
  const known = new Set(releaseAncestry(map, from, false).map((release) => release.id));
  return releaseAncestry(map, tip, false).filter((release) => !known.has(release.id)).length;
}

export function activeVariances(variances: Variance[] | undefined, now = Date.now()) {
  return (variances ?? []).filter(
    (variance) => !variance.until || Date.parse(variance.until) > now,
  );
}

export function lineTip(
  available: Map<string, DatabaseRelease>,
  track: string,
  pinned?: string | null,
): DatabaseRelease | null {
  return lineStatus(available, track, pinned).tip;
}

export function lineStatus(
  available: Map<string, DatabaseRelease>,
  track: string,
  pinned?: string | null,
  from?: string,
) {
  const allowed = pinned
    ? new Set(releaseAncestry(available, pinned, false).map((release) => release.id))
    : null;
  const candidates = [...available.values()].filter(
    (release) => releaseTrack(release) === track && (!allowed || allowed.has(release.id)),
  );
  const parents = new Set(candidates.flatMap((release) => releaseParents(release)));
  let latest: DatabaseRelease | null = null;
  let reachable: { tip: DatabaseRelease; pending: number } | null = null;
  for (const release of candidates) {
    if (parents.has(release.id)) continue;
    if (!latest || release.createdAt > latest.createdAt) latest = release;
    if (!from) continue;
    const ancestry = releaseAncestry(available, release.id, false);
    if (!ancestry.some((entry) => entry.id === from)) continue;
    const known = new Set(releaseAncestry(available, from, false).map((entry) => entry.id));
    const pending = ancestry.filter((entry) => !known.has(entry.id)).length;
    if (!reachable || release.createdAt > reachable.tip.createdAt)
      reachable = { tip: release, pending };
  }
  if (reachable) return { ...reachable, diverged: false };
  return {
    tip: latest,
    pending: 0,
    diverged: Boolean(from && latest && available.has(from) && latest.id !== from),
  };
}

export type BaselineStatus = "done" | "open" | "decision";

export interface BaselineEntry {
  id: string;
  title: string;
  release: string;
  data: boolean;
  status: BaselineStatus;
  suggested: "done" | "open";
  objects: string[];
}

export interface BaselineClassification {
  changes: BaselineEntry[];
  variances: Variance[];
  missing: string[];
}

export function classifyBaseline(
  map: Map<string, DatabaseRelease>,
  releaseId: string,
  actual: Map<string, string>,
  standalone: Map<string, StandaloneChange> = new Map(),
): BaselineClassification {
  const closure = releaseClosure(map, releaseId, standalone);
  const reference = map.get(releaseId);
  if (!reference) throw new Error(`Release ${releaseId} fehlt.`);
  const indexes = new Map<DatabaseRelease, Map<string, string>>();
  const hashIn = (release: DatabaseRelease | undefined, id: string) => {
    if (!release) return null;
    let index = indexes.get(release);
    if (!index) {
      index = new Map(release.objects.map((entry) => [entry.object.id, entry.checksum]));
      indexes.set(release, index);
    }
    return index.get(id) ?? null;
  };
  const timelines = new Map<string, { states: (string | null)[]; groups: string[] }>();
  const groupOf = new Map<string, number>();
  for (const change of closure.changes) {
    const owner = closure.owner.get(change.id) ?? releaseId;
    const release = map.get(owner);
    for (const id of change.touches) {
      let line = timelines.get(id);
      if (!line) {
        const initial =
          id in change.before
            ? change.before[id]
            : hashIn(map.get(releaseParents(release ?? reference)[0] ?? ""), id);
        line = { states: [initial], groups: [] };
        timelines.set(id, line);
      }
      if (line.groups[line.groups.length - 1] !== owner) {
        line.groups.push(owner);
        line.states.push(hashIn(release, id));
      }
      groupOf.set(`${change.id}\0${id}`, line.groups.length);
    }
  }
  const reached = new Map<string, number | null>();
  for (const [id, line] of timelines) {
    const current = actual.get(id) ?? null;
    let found: number | null = null;
    for (let index = line.states.length - 1; index >= 0; index--)
      if (line.states[index] === current) {
        found = index;
        break;
      }
    reached.set(id, found);
  }
  const entries: BaselineEntry[] = closure.changes.map((change) => {
    const states = change.touches.map((id) => {
      const position = reached.get(id);
      if (position === null || position === undefined) return "decision" as const;
      return position >= (groupOf.get(`${change.id}\0${id}`) ?? 0)
        ? ("done" as const)
        : ("open" as const);
    });
    const status: BaselineStatus = !states.length
      ? "decision"
      : states.every((state) => state === "done")
        ? "done"
        : states.every((state) => state === "open")
          ? "open"
          : "decision";
    return {
      id: change.id,
      title: change.title,
      release: closure.owner.get(change.id) ?? releaseId,
      data: change.data,
      status,
      suggested: status === "open" ? "open" : "done",
      objects: change.touches,
    };
  });
  const releaseOrder = new Map(closure.releases.map((release, index) => [release.id, index]));
  let firstOpen = Number.POSITIVE_INFINITY;
  for (const entry of entries)
    if (entry.status === "open")
      firstOpen = Math.min(firstOpen, releaseOrder.get(entry.release) ?? 0);
  for (const entry of entries)
    if (!entry.objects.length)
      entry.suggested = (releaseOrder.get(entry.release) ?? 0) < firstOpen ? "done" : "open";
  const variances: Variance[] = [];
  const missing: string[] = [];
  for (const entry of reference.objects) {
    const id = entry.object.id;
    const current = actual.get(id);
    const explained = timelines.has(id) ? reached.get(id) !== null : current === entry.checksum;
    if (explained) continue;
    if (current === undefined) missing.push(id);
    else
      variances.push({
        object: id,
        hash: current,
        reason: "Altstand bei der Aufnahme",
        until: null,
      });
  }
  return { changes: entries, variances, missing };
}

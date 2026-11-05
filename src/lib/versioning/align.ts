import type { SavedConnection } from "@/lib/connections";
import { captureObject } from "./capture";
import { activeVariances, planChanges } from "./change-plan";
import { control, type PolicyRecord } from "./control";
import { readChangeLedger } from "./ledger";
import { generateMigration } from "./migrations";
import { checksum, releaseTrack } from "./model";
import {
  changePath,
  encode,
  loadReleases,
  loadStandaloneChanges,
  readTargets,
  resolveRelease,
  saveFile,
  saveTargets,
} from "./repository";
import type {
  DatabaseRelease,
  DatabaseTarget,
  ObjectSnapshot,
  StandaloneChange,
  VersioningProject,
} from "./types";

export interface AlignmentDraft {
  id: string;
  standard: string;
  from: string;
  open: string[];
  variances: string[];
  sql: string;
  issues: { label: string; reason: string }[];
  change: StandaloneChange | null;
}

export async function alignmentDraft(
  repo: string,
  project: VersioningProject,
  target: DatabaseTarget,
  connection: SavedConnection,
  standardId: string,
  allowDrops = false,
): Promise<AlignmentDraft> {
  if (!target.release) throw new Error("Das Ziel hat noch keine Baseline.");
  const releases = await loadReleases(repo, project);
  const map = new Map(releases.map((release) => [release.id, release]));
  const standard = map.get(standardId);
  if (!standard || releaseTrack(standard) !== "main")
    throw new Error("Als Standard einen Release der Linie main wählen.");
  const from = await resolveRelease(repo, project, target.release);
  const ledger = await readChangeLedger(connection, project, target);
  const plan = planChanges(
    map,
    standard.id,
    ledger?.changes ?? new Map(),
    from.id,
    await loadStandaloneChanges(repo, project),
  );
  const variances = activeVariances(target.variances);
  const expected = from.objects.filter((entry) =>
    variances.some((variance) => variance.object === entry.object.id),
  );
  const actual: ObjectSnapshot[] = [];
  for (const entry of expected)
    actual.push(await captureObject(connection, target.database, entry.object, target.schema));
  const draft = generateMigration(
    project.kind,
    { objects: actual } as unknown as DatabaseRelease,
    expected,
    allowDrops,
  );
  const id = `angleichen-${target.id.replace(/[^A-Za-z0-9_-]/g, "-")}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
  const change: StandaloneChange | null =
    draft.sql && !draft.issues.length
      ? {
          format: 1,
          id,
          kind: "versioned",
          title: `${target.name} an ${from.id} angleichen`,
          checksum: await checksum(draft.sql),
          sql: draft.sql,
          touches: actual.map((entry) => entry.object.id),
          before: Object.fromEntries(actual.map((entry) => [entry.object.id, entry.checksum])),
          requires: [],
          data: false,
          preconditions: [],
          postconditions: [],
        }
      : null;
  return {
    id,
    standard: standard.id,
    from: from.id,
    open: plan.open.map((entry) => entry.id),
    variances: variances.map((variance) => variance.object),
    sql: draft.sql,
    issues: draft.issues,
    change,
  };
}

export async function saveAlignment(repo: string, draft: AlignmentDraft) {
  if (!draft.change) throw new Error("Die Angleich-Änderung hat offene Punkte.");
  const { sql, ...manifest } = draft.change;
  const path = changePath(draft.change.id);
  await saveFile(repo, path.replace(/\.json$/, ".sql"), `${sql}\n`, null);
  await saveFile(repo, path, encode(manifest), null);
  return [path, path.replace(/\.json$/, ".sql")];
}

export async function finishAlignment(
  repo: string,
  project: VersioningProject,
  targetId: string,
  connection: SavedConnection,
) {
  const { store, text } = await readTargets(repo, project.id);
  const target = store.targets.find((entry) => entry.id === targetId);
  if (!target) throw new Error("Datenbankziel fehlt.");
  target.variances = undefined;
  if ((target.track ?? "main") !== "main" || target.pinnedRelease) {
    const record = await control<PolicyRecord>(connection, project, target, "policy");
    const saved = await control<PolicyRecord>(connection, project, target, "save-policy", {
      policy: { ...record.policy, track: "main", pinnedRelease: null },
      revision: record.revision,
    });
    Object.assign(target, saved.policy);
  }
  await saveTargets(repo, store, text);
}

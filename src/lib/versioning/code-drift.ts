import type { SavedConnection } from "@/lib/connections";
import { captureObject } from "./capture";
import { activeVariances } from "./change-plan";
import { captureTolerant } from "./deploy";
import { readChangeLedger } from "./ledger";
import { readFile, readTargets, resolveRelease, saveFile, saveTargets } from "./repository";
import { sourceFiles } from "./sources";
import type {
  AppliedObject,
  DatabaseTarget,
  ObjectSnapshot,
  Variance,
  VersioningProject,
} from "./types";

export const CODE_TYPES = new Set(["view", "routine", "procedure", "package"]);

export type CodeState = "current" | "variance" | "pending" | "drift" | "missing";

export interface CodeStatus {
  target: string;
  object: string;
  label: string;
  state: CodeState;
}

export function codeStatus(
  target: DatabaseTarget,
  expected: ObjectSnapshot[],
  actual: Map<string, string>,
  applied: Map<string, AppliedObject>,
  variances: Variance[],
): CodeStatus[] {
  const accepted = new Map(variances.map((variance) => [variance.object, variance.hash]));
  return expected
    .filter((entry) => CODE_TYPES.has(entry.object.selection.objectType))
    .map((entry) => {
      const id = entry.object.id;
      const ist = actual.get(id);
      const last = applied.get(id)?.hash;
      const state: CodeState =
        ist === undefined
          ? "missing"
          : ist === entry.checksum
            ? "current"
            : accepted.get(id) === ist
              ? "variance"
              : last !== undefined && ist === last
                ? "pending"
                : "drift";
      return {
        target: target.id,
        object: id,
        label: `${entry.object.selection.schema}.${entry.object.selection.objectName}`,
        state,
      };
    });
}

export async function codeDriftReport(
  repo: string,
  project: VersioningProject,
  targets: DatabaseTarget[],
  connections: SavedConnection[],
) {
  const rows: CodeStatus[] = [];
  const problems: { target: string; error: string }[] = [];
  for (const target of targets) {
    const connection = connections.find((entry) => entry.id === target.connectionId);
    if (!target.release || !connection) continue;
    try {
      const release = await resolveRelease(repo, project, target.release);
      const code = release.objects.filter((entry) =>
        CODE_TYPES.has(entry.object.selection.objectType),
      );
      if (!code.length) continue;
      const ledger = await readChangeLedger(connection, project, target);
      const captured = await captureTolerant(connection, target, code);
      rows.push(
        ...codeStatus(
          target,
          code,
          new Map(captured.map((entry) => [entry.object.id, entry.checksum])),
          ledger?.objects ?? new Map(),
          activeVariances(target.variances),
        ),
      );
    } catch (error) {
      problems.push({ target: target.id, error: String(error) });
    }
  }
  return { rows, problems };
}

function managed(project: VersioningProject, objectId: string) {
  const object = project.objects.find((entry) => entry.id === objectId);
  if (!object) throw new Error(`${objectId} ist kein verwaltetes Objekt.`);
  return object;
}

export async function adoptCustomerCode(
  repo: string,
  project: VersioningProject,
  target: DatabaseTarget,
  connection: SavedConnection,
  objectId: string,
) {
  const snapshot = await captureObject(
    connection,
    target.database,
    managed(project, objectId),
    target.schema,
  );
  for (const [path, content] of Object.entries(sourceFiles(snapshot)))
    await saveFile(repo, path, content, await readFile(repo, path));
  return snapshot;
}

export async function recordCodeVariance(
  repo: string,
  project: VersioningProject,
  targetId: string,
  connection: SavedConnection,
  objectId: string,
  reason: string,
) {
  if (!reason.trim()) throw new Error("Einen Grund für die Abweichung angeben.");
  const { store, text } = await readTargets(repo, project.id);
  const target = store.targets.find((entry) => entry.id === targetId);
  if (!target) throw new Error("Datenbankziel fehlt.");
  const snapshot = await captureObject(
    connection,
    target.database,
    managed(project, objectId),
    target.schema,
  );
  target.variances = [
    ...(target.variances ?? []).filter((entry) => entry.object !== objectId),
    { object: objectId, hash: snapshot.checksum, reason: reason.trim(), until: null },
  ];
  await saveTargets(repo, store, text);
}

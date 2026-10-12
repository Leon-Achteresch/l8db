import { useBackupToolPaths } from "@/lib/backup-runner";
import { runBranchingJob } from "@/lib/branching/jobs";
import type { SavedConnection } from "@/lib/connections";
import { branchingSnapshot } from "@/lib/db";
import { prepareConnection } from "@/lib/schema-compare/store";
import { effectiveConnectionString } from "@/lib/ssh";
import { targetStage } from "./delivery";
import type { DatabaseTarget, VersioningProject } from "./types";

export function snapshotTargets(project: VersioningProject, targets: DatabaseTarget[]) {
  return project.kind === "postgres"
    ? targets.filter((target) => targetStage(target) === "production")
    : [];
}

export function snapshotDatabase(target: DatabaseTarget, connection: SavedConnection) {
  if (target.database?.trim()) return target.database.trim();
  try {
    const url = new URL(connection.connectionString);
    const name =
      decodeURIComponent(url.pathname.slice(1)) || url.searchParams.get("dbname")?.trim();
    if (name) return name;
  } catch {}
  throw new Error(`${target.name}: Datenbankname für die Sicherung fehlt.`);
}

function serverKey(connection: SavedConnection) {
  try {
    const url = new URL(connection.connectionString);
    const host = url.searchParams.get("host") || url.hostname;
    return `${host.toLowerCase()}:${url.searchParams.get("port") || url.port || "5432"}`;
  } catch {
    return connection.id;
  }
}

export async function snapshotBeforeRollout(
  project: VersioningProject,
  targets: DatabaseTarget[],
  connections: SavedConnection[],
  releaseId: string,
  onProgress?: (message: string) => void,
) {
  const created: { target: string; database: string; snapshot: string }[] = [];
  const done = new Set<string>();
  for (const target of snapshotTargets(project, targets)) {
    const saved = connections.find((item) => item.id === target.connectionId);
    if (!saved) throw new Error(`${target.name}: Zielverbindung fehlt.`);
    const database = snapshotDatabase(target, saved);
    const key = `${serverKey(saved)}\u0000${database}`;
    if (done.has(key)) continue;
    done.add(key);
    onProgress?.(`${target.name}: Sicherung vor ${releaseId} wird erstellt`);
    const connection = await prepareConnection(saved.id);
    const job = await runBranchingJob(
      () =>
        branchingSnapshot(
          effectiveConnectionString(connection),
          {
            database,
            label: `Vor Release ${releaseId}`,
            note: `Automatisch vor dem Rollout von ${releaseId} auf ${target.name} erstellt.`,
          },
          useBackupToolPaths.getState().paths,
        ),
      `Sicherung vor ${releaseId} · ${target.name}`,
      connection,
      database,
    ).catch((error) => {
      throw new Error(
        `${target.name}: Sicherung vor dem Rollout fehlgeschlagen. Rollout nicht gestartet. ${String(error).replace(/^Error: /, "")}`,
      );
    });
    created.push({
      target: target.name,
      database,
      snapshot: typeof job.result?.snapshot === "string" ? job.result.snapshot : job.id,
    });
  }
  return created;
}

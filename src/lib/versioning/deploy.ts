import type { SavedConnection } from "@/lib/connections";
import {
  beginTransaction,
  commitTransaction,
  executeInTransaction,
  executeScript,
  listCompileErrors,
  listInvalidObjects,
  rollbackTransaction,
} from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { captureObjects } from "./capture";
import {
  acquireLease,
  advanceLedger,
  baselineLedger,
  finishLease,
  readLedger,
  releaseHash,
} from "./ledger";
import { checksum, compareSnapshots, releaseChain, validateMigration } from "./model";
import {
  committedRelease,
  loadReleases,
  readTargets,
  resolveRelease,
  saveTargets,
} from "./repository";
import { requalify } from "./schema";
import type {
  DatabaseRelease,
  DatabaseTarget,
  DeploymentEvent,
  ObjectDifference,
  ReleaseReference,
  VersioningProject,
} from "./types";

export interface DeploymentPlan {
  target: DatabaseTarget;
  from: DatabaseRelease;
  to: DatabaseRelease;
  reference: ReleaseReference;
  releases: DatabaseRelease[];
  differences: ObjectDifference[];
  reviewToken: string;
  sql: string[];
}

export function mappedMigration(
  sql: string,
  target: DatabaseTarget,
  release: DatabaseRelease,
): string {
  const schemas = [...new Set(release.objects.map((item) => item.object.selection.schema))];
  if (!target.schema) return sql;
  if (schemas.length !== 1 || !schemas[0])
    throw new Error("Schema-Zuordnung benötigt genau ein Quellschema pro Release.");
  return requalify(sql, schemas[0], target.schema);
}

export async function inspectTarget(
  repo: string,
  project: VersioningProject,
  target: DatabaseTarget,
  connection: SavedConnection,
) {
  if (connection.id !== target.connectionId || connection.kind !== project.kind)
    throw new Error("Zielverbindung passt nicht zum Projekt.");
  if (!target.release) throw new Error("Bitte zuerst einen geprüften Ausgangsrelease zuordnen.");
  const release = await resolveRelease(repo, project, target.release);
  const actual = await captureObjects(
    connection,
    target.database,
    release.objects.map((item) => item.object),
    target.schema,
  );
  return { release, actual, differences: compareSnapshots(release.objects, actual) };
}

export async function baselineTarget(
  repo: string,
  project: VersioningProject,
  targetId: string,
  connection: SavedConnection,
  releaseId: string,
  reconcile = false,
) {
  const { store, text } = await readTargets(repo, project.id);
  const target = store.targets.find((item) => item.id === targetId);
  if (!target || connection.id !== target.connectionId || connection.kind !== project.kind)
    throw new Error("Zielverbindung passt nicht zum Projekt.");
  if (target.release && !reconcile)
    throw new Error("Dieses Ziel hat bereits eine Baseline. Änderungen müssen ausgerollt werden.");
  const { release, reference } = await committedRelease(repo, project, releaseId);
  if (!release.objects.length)
    throw new Error("Eine Baseline benötigt mindestens ein verwaltetes Objekt.");
  const actual = await captureObjects(
    connection,
    target.database,
    release.objects.map((item) => item.object),
    target.schema,
  );
  if (compareSnapshots(release.objects, actual).some((item) => item.status !== "unchanged"))
    throw new Error(
      "Der tatsächliche Datenbankstand entspricht nicht dem Release. Baseline wurde nicht gesetzt.",
    );
  if (project.kind === "oracle") {
    for (const schema of new Set(
      release.objects.map((item) => target.schema || item.object.selection.schema || ""),
    )) {
      const invalid = await listInvalidObjects(
        connection.kind,
        effectiveConnectionString(connection),
        target.database ?? undefined,
        schema,
      );
      if (
        invalid.some((item) =>
          release.objects.some((entry) => entry.object.selection.objectName === item.name),
        )
      )
        throw new Error(
          "Verwaltete Oracle-Objekte sind ungültig. Vor der Baseline kompilieren und prüfen.",
        );
    }
  }
  const pending = target.history.find(
    (event) => event.status === "running" || event.status === "failed",
  );
  if (pending && !reconcile)
    throw new Error("Ungeklärtes Deployment. Erst den tatsächlichen Stand abgleichen.");
  if (reconcile && pending) {
    pending.status = "reconciled";
    pending.finishedAt = new Date().toISOString();
  }
  await baselineLedger(connection, project, target, release, reconcile);
  target.release = reference;
  await saveTargets(repo, store, text);
}

export async function planDeployment(
  repo: string,
  project: VersioningProject,
  target: DatabaseTarget,
  connection: SavedConnection,
  releaseId: string,
): Promise<DeploymentPlan> {
  if (connection.readOnly) throw new Error("Die Zielverbindung ist schreibgeschützt.");
  if (target.history.some((event) => event.status === "running" || event.status === "failed"))
    throw new Error(
      "Ein früheres Deployment ist ungeklärt. Vor dem nächsten Update den Stand abgleichen.",
    );
  const { release: from, differences } = await inspectTarget(repo, project, target, connection);
  const ledger = await readLedger(connection, project, target);
  if (
    !ledger ||
    ledger.RELEASE_HASH !== (await releaseHash(from)) ||
    ledger.STATUS !== "ready" ||
    ledger.LEASE
  )
    throw new Error(
      "Datenbank-Historie weicht ab oder ein Deployment ist ungeklärt. Stand zuerst abgleichen.",
    );
  const { release: to, reference } = await committedRelease(repo, project, releaseId);
  const releases = await loadReleases(repo, project, reference.commit);
  const storedFrom = releases.find((entry) => entry.id === from.id);
  if (!storedFrom || JSON.stringify(storedFrom) !== JSON.stringify(from))
    throw new Error("Der Ausgangsrelease wurde nachträglich verändert oder fehlt im Zielbranch.");
  if (target.schema && new Set(to.objects.map((item) => item.object.selection.schema)).size !== 1)
    throw new Error("Eine Schema-Zuordnung benötigt genau ein Quellschema.");
  const chain = releaseChain(releases, from.id, to.id);
  if (chain.some((release) => !release.migrations.length))
    throw new Error("Ein Update-Release enthält keine Migrationen.");
  const sql = chain.flatMap((release) =>
    release.migrations.map((migration) => mappedMigration(migration.sql, target, release)),
  );
  for (const statement of sql) validateMigration(statement, project.kind);
  const reviewToken = await checksum(
    JSON.stringify({
      connectionId: target.connectionId,
      database: target.database,
      schema: target.schema ?? null,
      production: target.production,
      from: target.release,
      reference,
      sql,
    }),
  );
  return { target, from, to, reference, releases: chain, differences, sql, reviewToken };
}

export async function deploy(
  repo: string,
  project: VersioningProject,
  targetId: string,
  connection: SavedConnection,
  releaseId: string,
  reviewedToken: string,
  onProgress?: (message: string) => void,
) {
  let { store, text } = await readTargets(repo, project.id);
  const target = store.targets.find((item) => item.id === targetId);
  if (!target) throw new Error("Datenbankziel fehlt.");
  const plan = await planDeployment(repo, project, target, connection, releaseId);
  if (plan.reviewToken !== reviewedToken)
    throw new Error("Repository wurde seit der Prüfung geändert. Update neu planen.");
  if (plan.differences.some((item) => item.status !== "unchanged"))
    throw new Error("Direkte Datenbankänderungen erkannt. Bitte zuerst prüfen und zusammenführen.");
  if (!plan.releases.length) return;
  const event: DeploymentEvent = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    from: target.release,
    to: plan.reference,
    status: "running",
    completedMigrations: [],
    error: null,
  };
  target.history.unshift(event);
  text = await saveTargets(repo, store, text);
  const url = effectiveConnectionString(connection);
  const db = target.database ?? undefined;
  let previous = plan.from;
  let leased = false;
  try {
    await acquireLease(connection, project, target, plan.from, event.id);
    leased = true;
    for (const release of plan.releases) {
      onProgress?.(`${target.name}: ${release.id}`);
      const actual = await captureObjects(
        connection,
        target.database,
        previous.objects.map((item) => item.object),
        target.schema,
      );
      if (compareSnapshots(previous.objects, actual).some((item) => item.status !== "unchanged"))
        throw new Error("Datenbank wurde seit der Planung geändert.");
      const schemas = [
        ...new Set(
          release.objects.map((item) => target.schema || item.object.selection.schema || ""),
        ),
      ];
      const invalidBefore =
        project.kind === "oracle"
          ? (
              await Promise.all(
                schemas.map((schema) => listInvalidObjects(connection.kind, url, db, schema)),
              )
            ).flat()
          : [];
      if (project.kind === "postgres") {
        const transaction = await beginTransaction(connection.kind, url, db);
        try {
          await executeInTransaction(transaction, "SET LOCAL lock_timeout = '5s'", {
            confirmed: true,
          });
          for (const migration of release.migrations) {
            for (const sql of validateMigration(
              mappedMigration(migration.sql, target, release),
              project.kind,
            ))
              await executeInTransaction(transaction, sql, { confirmed: true });
          }
          await advanceLedger(connection, project, target, release, event.id, transaction);
          await commitTransaction(transaction);
        } catch (error) {
          try {
            await rollbackTransaction(transaction);
          } catch (rollbackError) {
            throw new Error(
              `${String(error)}; Rollback konnte nicht bestätigt werden: ${String(rollbackError)}`,
            );
          }
          throw error;
        }
        event.completedMigrations.push(...release.migrations.map((migration) => migration.id));
        text = await saveTargets(repo, store, text);
      } else {
        for (const migration of release.migrations) {
          const statements = validateMigration(
            mappedMigration(migration.sql, target, release),
            project.kind,
          );
          for (const statement of statements) {
            const results = await executeScript(connection.kind, url, statement, db, {
              confirmed: true,
            });
            const failure = results.find((item) => !item.success);
            if (failure || results.length !== 1)
              throw new Error(
                failure?.error ?? "Oracle-Anweisung wurde nicht eindeutig ausgeführt.",
              );
          }
          event.completedMigrations.push(migration.id);
          text = await saveTargets(repo, store, text);
        }
        for (const schema of new Set(
          release.objects.map((item) => item.object.selection.schema ?? ""),
        )) {
          const invalid = await listInvalidObjects(
            connection.kind,
            url,
            db,
            target.schema || schema,
          );
          const relevant = invalid.filter(
            (item) =>
              release.objects.some((entry) => entry.object.selection.objectName === item.name) ||
              !invalidBefore.some(
                (old) =>
                  old.schema === item.schema &&
                  old.name === item.name &&
                  old.object_type === item.object_type,
              ),
          );
          if (relevant.length) {
            const errors = await listCompileErrors(
              connection.kind,
              url,
              db,
              target.schema || schema,
            );
            throw new Error(
              `Ungültige Oracle-Objekte: ${relevant.map((item) => `${item.name} (${item.object_type})`).join(", ")}\n${errors
                .filter((error) => relevant.some((item) => item.name === error.name))
                .map((error) => `${error.name}:${error.line ?? "?"} ${error.message}`)
                .join("\n")}`,
            );
          }
        }
      }
      const after = await captureObjects(
        connection,
        target.database,
        release.objects.map((item) => item.object),
        target.schema,
      );
      if (compareSnapshots(release.objects, after).some((item) => item.status !== "unchanged"))
        throw new Error(
          "Migration ausgeführt, aber der Zielstand stimmt nicht mit dem Release überein.",
        );
      if (project.kind === "oracle")
        await advanceLedger(connection, project, target, release, event.id);
      target.release = {
        ...plan.reference,
        id: release.id,
        path: `database/releases/${release.id}.json`,
      };
      text = await saveTargets(repo, store, text);
      previous = release;
    }
    await finishLease(connection, project, target, event.id, true);
    leased = false;
    event.status = "succeeded";
    event.finishedAt = new Date().toISOString();
    await saveTargets(repo, store, text);
  } catch (error) {
    if (leased) {
      try {
        await finishLease(connection, project, target, event.id, false);
      } catch {
        event.error = "Datenbank-Sperre konnte nicht als fehlgeschlagen markiert werden. ";
      }
    }
    event.status = "failed";
    event.finishedAt = new Date().toISOString();
    event.error = `${event.error ?? ""}${String(error)}${project.kind === "oracle" ? " Bereits ausgeführte Oracle-DDL kann gespeichert sein." : " Bereits abgeschlossene Releases bleiben angewendet."}`;
    try {
      await saveTargets(repo, store, text);
    } catch {
      throw new Error(
        `${event.error}\nHistorie konnte nicht aktualisiert werden. Deployment bleibt als ungeklärt markiert.`,
      );
    }
    throw new Error(event.error);
  }
}

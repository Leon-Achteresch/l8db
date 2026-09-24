import type { SavedConnection } from "@/lib/connections";
import {
  listInvalidObjects,
  rollbackTransaction,
  versioningRun,
  versioningRunStatus,
} from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { bindingMatches } from "./binding";
import { captureObjects } from "./capture";
import { mappedCheck, preflightChecks, runReleaseChecks } from "./checks";
import { control, initialPolicy, type PolicyRecord, sharedTarget } from "./control";
import { baselineLedger, readLedger, releaseHash } from "./ledger";
import { checksum, compareSnapshots, releaseChain, releaseTrack, validateMigration } from "./model";
import {
  committedRelease,
  loadReleases,
  readTargets,
  resolveRelease,
  saveTargets,
} from "./repository";
import { releaseRisks, requiresMaintenance, validateProductionRelease } from "./safety";
import { assertMappedWriteScope, requalify } from "./schema";
import { databaseBinding, openVersioningSession, versioningSessionSettings } from "./session";
import { assertDistinctTarget } from "./targets";
import type {
  DatabaseRelease,
  DatabaseTarget,
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
  binding: NonNullable<DatabaseTarget["binding"]>;
  risks: string[];
  policy: PolicyRecord;
  reviewArtifact: string;
}

export function assertReviewedToken(reviewed: string, current: string, now = Date.now()) {
  const [issued, hash] = reviewed.split(":");
  const time = Number(issued);
  if (
    !Number.isFinite(time) ||
    time > now ||
    now - time > 15 * 60 * 1000 ||
    !/^[a-f0-9]{64}$/.test(hash ?? "") ||
    hash !== current.split(":")[1]
  )
    throw new Error("Freigabe ist veraltet oder Ziel/Release wurde geändert. Update neu planen.");
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
  const mapped = requalify(sql, schemas[0], target.schema);
  assertMappedWriteScope(mapped, target.schema, release.kind);
  return mapped;
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
  connections: SavedConnection[] = [connection],
) {
  const { store, text } = await readTargets(repo, project.id);
  const target = store.targets.find((item) => item.id === targetId);
  if (!target || connection.id !== target.connectionId || connection.kind !== project.kind)
    throw new Error("Zielverbindung passt nicht zum Projekt.");
  if (target.release && !reconcile)
    throw new Error("Dieses Ziel hat bereits eine Baseline. Änderungen müssen ausgerollt werden.");
  const { release, reference } = await committedRelease(repo, project, releaseId);
  target.ledgerSchema ??= target.schema || release.objects[0]?.object.selection.schema || undefined;
  if (!release.objects.length)
    throw new Error("Eine Baseline benötigt mindestens ein verwaltetes Objekt.");
  await assertDistinctTarget(target, connection, store.targets, connections, project);
  const shared = await control<PolicyRecord>(connection, project, target, "initialize", {
    policy: initialPolicy(target),
  });
  Object.assign(target, shared.policy);
  if (releaseTrack(release) !== target.track)
    throw new Error("Baseline gehört zu einer anderen gemeinsamen Release-Linie.");
  const lock = await control<string>(
    connection,
    project,
    target,
    reconcile ? "recovery-lock" : "baseline-lock",
    {
      schemas: [
        ...new Set(release.objects.map((entry) => target.schema || entry.object.selection.schema)),
      ],
    },
  );
  try {
    const current = await readTargets(repo, project.id);
    await assertDistinctTarget(target, connection, current.store.targets, connections, project);
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
      for (const event of target.history.filter(
        (event) => event.status === "running" || event.status === "failed",
      )) {
        event.status = "reconciled";
        event.finishedAt = new Date().toISOString();
      }
    }
    if (release.safety?.postconditions.length) {
      const transaction = await openVersioningSession(connection, target, release, true);
      try {
        await runReleaseChecks(transaction, release, target, "postconditions");
      } finally {
        await rollbackTransaction(transaction);
      }
    }
    target.binding = await databaseBinding(connection, target);
    await baselineLedger(connection, project, target, release, reconcile);
    target.release = reference;
    await control(connection, project, target, "append", {
      runId: crypto.randomUUID(),
      event: reconcile ? "reconciled" : "baseline",
      body: { release: reference, binding: target.binding },
    });
    await saveTargets(repo, store, text);
  } finally {
    await rollbackTransaction(lock);
  }
}

export async function planDeployment(
  repo: string,
  project: VersioningProject,
  target: DatabaseTarget,
  connection: SavedConnection,
  releaseId: string,
): Promise<DeploymentPlan> {
  if (connection.readOnly) throw new Error("Die Zielverbindung ist schreibgeschützt.");
  const shared = await sharedTarget(connection, project, target);
  target = shared.target;
  if (target.paused) throw new Error("Updates für diese Datenbank sind pausiert.");
  if (target.history.some((event) => event.status === "running" || event.status === "failed"))
    throw new Error(
      "Ein früheres Deployment ist ungeklärt. Vor dem nächsten Update den Stand abgleichen.",
    );
  const { release: from, differences } = await inspectTarget(repo, project, target, connection);
  target = {
    ...target,
    ledgerSchema:
      target.ledgerSchema || target.schema || from.objects[0]?.object.selection.schema || undefined,
  };
  const binding = await databaseBinding(connection, target);
  const registered = (await readTargets(repo, project.id)).store.targets.find(
    (entry) =>
      entry.id !== target.id &&
      entry.binding?.physicalKey &&
      entry.binding.physicalKey === binding.physicalKey,
  );
  if (registered)
    throw new Error(
      `${registered.name} verwendet bereits dieselbe Datenbank und dasselbe Schema. Rollout für diesen Alias blockiert.`,
    );
  if (target.binding && !bindingMatches(target.binding, binding))
    throw new Error(
      "Verbindungsendpunkt, Datenbank oder Oracle-Edition hat sich geändert. Ziel ausdrücklich neu abgleichen.",
    );
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
  if (releaseTrack(to) !== (target.track ?? "main"))
    throw new Error("Zielrelease gehört zu einer anderen Kundenvariante / Release-Linie.");
  if (target.pinnedRelease) releaseChain(releases, to.id, target.pinnedRelease);
  const storedFrom = releases.find((entry) => entry.id === from.id);
  if (!storedFrom || JSON.stringify(storedFrom) !== JSON.stringify(from))
    throw new Error("Der Ausgangsrelease wurde nachträglich verändert oder fehlt im Zielbranch.");
  if (!target.release) throw new Error("Gespeicherter Ausgangsrelease fehlt.");
  const history = await loadReleases(repo, project, target.release.commit);
  const previousById = new Map(history.map((release) => [release.id, release]));
  let ancestor: DatabaseRelease | undefined = from;
  while (ancestor) {
    if (
      JSON.stringify(releases.find((release) => release.id === ancestor?.id)) !==
      JSON.stringify(ancestor)
    )
      throw new Error(
        "Eine bereits angewendete Vorgängermigration wurde im Zielbranch verändert oder entfernt.",
      );
    ancestor = ancestor.parent ? previousById.get(ancestor.parent) : undefined;
  }
  if (target.schema && new Set(to.objects.map((item) => item.object.selection.schema)).size !== 1)
    throw new Error("Eine Schema-Zuordnung benötigt genau ein Quellschema.");
  const chain = releaseChain(releases, from.id, to.id);
  if (chain.some((release) => !release.migrations.length))
    throw new Error("Ein Update-Release enthält keine Migrationen.");
  if (target.production && chain.length) {
    validateProductionRelease(to);
    if (chain.some(requiresMaintenance) && to.safety?.compatibility !== "maintenance")
      throw new Error(
        "Ein Zwischenrelease enthält inkompatible Änderungen. Der Betriebsplan benötigt ein Wartungsfenster für den gesamten Pfad.",
      );
  }
  if (chain[0]) await preflightChecks(connection, target, chain[0]);
  const sql = chain.flatMap((release) =>
    release.migrations.map((migration) => mappedMigration(migration.sql, target, release)),
  );
  for (const statement of sql) validateMigration(statement, project.kind);
  const snapshots = (release: DatabaseRelease) =>
    release.objects.map((entry) => ({
      schema: target.schema || entry.object.selection.schema,
      sourceSchema: entry.object.selection.schema,
      name: entry.object.selection.objectName,
      kind: entry.object.selection.objectType,
      metadataVersion: entry.object.metadataVersion,
      definition: entry.definition,
    }));
  const execution = {
    context: binding.context,
    fromId: from.id,
    fromHash: await releaseHash(from),
    fromObjects: snapshots(from),
    reference,
    releases: await Promise.all(
      chain.map(async (release) => ({
        id: release.id,
        hash: await releaseHash(release),
        objects: snapshots(release),
        statements: release.migrations.flatMap((migration) =>
          validateMigration(mappedMigration(migration.sql, target, release), project.kind).map(
            (sql, index) => ({
              id: `${release.id}:${migration.id}:${index + 1}`,
              migration: migration.id,
              sql,
            }),
          ),
        ),
        preconditions: (release.safety?.preconditions ?? []).map((entry) =>
          mappedCheck(entry, release, target),
        ),
        postconditions: (release.safety?.postconditions ?? []).map((entry) =>
          mappedCheck(entry, release, target),
        ),
        ...versioningSessionSettings(connection, target, release),
      })),
    ),
  };
  const reviewArtifact = JSON.stringify({
    execution,
    policyRevision: shared.record.revision,
    connectionId: target.connectionId,
    targetId: target.id,
    binding,
    ledgerSchema: target.ledgerSchema,
    track: target.track ?? "main",
    pinnedRelease: target.pinnedRelease ?? null,
    releases: chain,
    database: target.database,
    schema: target.schema ?? null,
    production: target.production,
    from: target.release,
    reference,
    sql,
  });
  const hash = await checksum(reviewArtifact);
  return {
    target,
    from,
    to,
    reference,
    releases: chain,
    differences,
    sql,
    reviewToken: `${Date.now()}:${hash}`,
    binding,
    risks: [...new Set(chain.flatMap(releaseRisks))],
    policy: shared.record,
    reviewArtifact,
  };
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
  const { store } = await readTargets(repo, project.id);
  const target = store.targets.find((item) => item.id === targetId);
  if (!target) throw new Error("Datenbankziel fehlt.");
  const plan = await planDeployment(repo, project, target, connection, releaseId);
  assertReviewedToken(reviewedToken, plan.reviewToken);
  if (plan.differences.some((item) => item.status !== "unchanged"))
    throw new Error("Direkte Datenbankänderungen erkannt. Bitte zuerst prüfen und zusammenführen.");
  if (!plan.releases.length) return;
  const id = await versioningRun({
    repo,
    targetId,
    runId: crypto.randomUUID(),
    artifact: plan.reviewArtifact,
    connection: {
      kind: connection.kind,
      connectionString: effectiveConnectionString(connection),
      database: target.database,
      schema: plan.target.ledgerSchema,
      projectId: project.id,
      readOnly: connection.readOnly ?? false,
    },
  });
  for (;;) {
    const status = await versioningRunStatus(id);
    onProgress?.(`${target.name}: ${status.release || "Wird geprüft"}`);
    if (status.status === "failed")
      throw new Error(status.error ?? "Ausführung fehlgeschlagen. Datenbankjournal prüfen.");
    if (status.status === "succeeded") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

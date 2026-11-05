import type { SavedConnection } from "@/lib/connections";
import {
  listInvalidObjects,
  rollbackTransaction,
  versioningRun,
  versioningRunStatus,
} from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { bindingMatches } from "./binding";
import { captureObject, captureObjects } from "./capture";
import {
  activeVariances,
  objectHistory,
  type PlannedStep,
  planChanges,
  releaseClosure,
} from "./change-plan";
import { mappedCheck, preflightChecks, runReleaseChecks } from "./checks";
import { control, initialPolicy, type PolicyRecord, sharedTarget } from "./control";
import {
  checkDelivery,
  type DeliveryReport,
  type Promotion,
  promotionSources,
  runRequest,
} from "./delivery";
import {
  adoptLedger,
  baselineLedger,
  type ChangeLedger,
  changeRows,
  isReady,
  LEDGER_READY,
  objectRows,
  readChangeLedger,
  readLedger,
  releaseHash,
  writeChangeLedger,
} from "./ledger";
import {
  checksum,
  compareSnapshots,
  deployKind,
  releaseAncestry,
  releaseParents,
  releaseTrack,
  validateMigration,
} from "./model";
import {
  committedRelease,
  committedTeamConfiguration,
  loadReleases,
  loadStandaloneChanges,
  readTargets,
  resolveRelease,
  saveTargets,
} from "./repository";
import { releaseRisks, requiresMaintenance, validateProductionRelease } from "./safety";
import { assertMappedWriteScope, requalify } from "./schema";
import { databaseBinding, openVersioningSession, versioningSessionSettings } from "./session";
import { assertDistinctTarget } from "./targets";
import type {
  AppliedObject,
  Change,
  DatabaseRelease,
  DatabaseTarget,
  ObjectDifference,
  ObjectSnapshot,
  ReleaseReference,
  StandaloneChange,
  VersioningProject,
} from "./types";

export interface DeploymentPlan {
  target: DatabaseTarget;
  from: DatabaseRelease;
  to: DatabaseRelease;
  reference: ReleaseReference;
  releases: DatabaseRelease[];
  steps: PlannedStep[];
  changes: Change[];
  differences: ObjectDifference[];
  drift: ObjectDifference[];
  reviewToken: string;
  sql: string[];
  binding: NonNullable<DatabaseTarget["binding"]>;
  risks: string[];
  policy: PolicyRecord;
  reviewArtifact: string;
  delivery: DeliveryReport | null;
  promotion: Promotion[];
  promotionProblems: string[];
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
    const releases = await loadReleases(repo, project, reference.commit);
    const closure = releaseClosure(
      new Map(releases.map((entry) => [entry.id, entry])),
      release.id,
      await loadStandaloneChanges(repo, project, reference.commit),
    );
    await recordBaseline(
      connection,
      project,
      target,
      release,
      closure.changes,
      closureObjects(release, actual),
    );
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
  const team = await committedTeamConfiguration(repo, project.id);
  if (connection.readOnly) throw new Error("Die Zielverbindung ist schreibgeschützt.");
  const shared = await sharedTarget(connection, project, target);
  if (team) {
    for (const field of [
      "production",
      "track",
      "pinnedRelease",
      "paused",
      "requireApproval",
      "operators",
      "reviewers",
      "administrators",
    ] as const)
      if (
        target[field] !== undefined &&
        JSON.stringify(target[field]) !== JSON.stringify(shared.record.policy[field])
      )
        throw new Error(
          "Git-Update-Regeln und gemeinsame Datenbankregeln unterscheiden sich. Update-Regeln zuerst abgleichen.",
        );
  }
  target = shared.target;
  if (target.paused) throw new Error("Updates für diese Datenbank sind pausiert.");
  if (target.history.some((event) => event.status === "running" || event.status === "failed"))
    throw new Error(
      "Ein früheres Deployment ist ungeklärt. Vor dem nächsten Update den Stand abgleichen.",
    );
  target = {
    ...target,
    ledgerSchema:
      target.ledgerSchema || target.schema || project.objects[0]?.selection.schema || undefined,
  };
  const binding = await databaseBinding(connection, target);
  const stored = (await readTargets(repo, project.id)).store.targets;
  const registered = stored.find(
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
  const state = await readLedger(connection, project, target);
  if (!state || !isReady(state.STATUS) || state.LEASE)
    throw new Error(
      "Datenbank-Historie weicht ab oder ein Deployment ist ungeklärt. Stand zuerst abgleichen.",
    );
  const { release: to, reference } = await committedRelease(repo, project, releaseId);
  const releases = await loadReleases(repo, project, reference.commit);
  const standalone = await loadStandaloneChanges(repo, project, reference.commit);
  const map = new Map(releases.map((release) => [release.id, release]));
  const from = map.get(state.RELEASE_ID);
  if (!from || (await releaseHash(from)) !== state.RELEASE_HASH)
    throw new Error(
      `Der Datenbankstand ${state.RELEASE_ID} fehlt im Zielbranch oder wurde nachträglich verändert.`,
    );
  if (releaseTrack(to) !== (target.track ?? "main"))
    throw new Error("Zielrelease gehört zu einer anderen Kundenvariante / Release-Linie.");
  if (
    target.pinnedRelease &&
    !releaseAncestry(map, target.pinnedRelease, false).some((release) => release.id === to.id)
  )
    throw new Error(`Diese Datenbank ist auf ${target.pinnedRelease} festgelegt.`);
  const ledger = await ensureLedger(connection, project, target, from, map, standalone, state);
  const variances = activeVariances(target.variances);
  const plan = planChanges(map, to.id, ledger.changes, from.id, standalone);
  if (target.schema && new Set(to.objects.map((item) => item.object.selection.schema)).size !== 1)
    throw new Error("Eine Schema-Zuordnung benötigt genau ein Quellschema.");
  const chain = plan.steps.map((step) => step.release);
  if (target.production && plan.open.length) {
    validateProductionRelease(to);
    if (chain.some(requiresMaintenance) && to.safety?.compatibility !== "maintenance")
      throw new Error(
        "Ein Zwischenrelease enthält inkompatible Änderungen. Der Betriebsplan benötigt ein Wartungsfenster für den gesamten Pfad.",
      );
  }
  if (chain[0]) await preflightChecks(connection, target, chain[0]);
  const varianceIds = new Set(variances.map((variance) => variance.object));
  const inspected = to.objects.filter(
    (entry) => plan.touched.has(entry.object.id) || varianceIds.has(entry.object.id),
  );
  const actual = await captureTolerant(connection, target, inspected);
  const differences = compareSnapshots(inspected, actual);
  const drift = differences.filter(
    (item) =>
      item.status !== "unchanged" && !plan.touched.has(item.id) && !varianceIds.has(item.id),
  );
  const history = objectHistory(releases);
  const sql: string[] = [];
  const steps = plan.steps.map((step) => {
    const statements: { id: string; migration: string; sql: string }[] = [];
    const changes = step.changes.map((change) => {
      const scope = change.release ? (map.get(change.release) ?? to) : to;
      const prefix = change.release
        ? `${change.release}:${change.id.slice(change.release.length + 1)}`
        : change.id;
      for (const [index, entry] of validateMigration(
        mappedMigration(change.sql, target, scope),
        deployKind(project.kind),
      ).entries()) {
        sql.push(entry);
        statements.push({ id: `${prefix}:${index + 1}`, migration: change.id, sql: entry });
      }
      return {
        id: change.id,
        checksum: change.checksum,
        kind: change.kind,
        requires: change.requires,
        touches: change.touches
          .map((id) => touchPayload(id, change, step.release, map, to, history, target))
          .sort((a, b) => a.id.localeCompare(b.id)),
        preconditions: change.preconditions.map((entry) => mappedCheck(entry, scope, target)),
        postconditions: change.postconditions.map((entry) => mappedCheck(entry, scope, target)),
      };
    });
    return { step, statements, changes };
  });
  const snapshots = (release: DatabaseRelease) =>
    release.objects.map((entry) => snapshotPayload(entry, target));
  const execution = {
    format: 2,
    context: binding.context,
    fromId: from.id,
    fromHash: await releaseHash(from),
    fromObjects: snapshots(from),
    reference,
    objects: to.objects.map((entry) => ({
      id: entry.object.id,
      ...snapshotPayload(entry, target),
    })),
    variances: [] as unknown[],
    releases: await Promise.all(
      steps.map(async ({ step, statements, changes }) => ({
        id: step.release.id,
        hash: await releaseHash(step.release),
        objects: snapshots(step.release),
        statements,
        changes,
        preconditions: (step.release.safety?.preconditions ?? []).map((entry) =>
          mappedCheck(entry, step.release, target),
        ),
        postconditions: (step.release.safety?.postconditions ?? []).map((entry) =>
          mappedCheck(entry, step.release, target),
        ),
        ...versioningSessionSettings(connection, target, step.release),
      })),
    ),
  };
  const reviewArtifact = JSON.stringify({
    teamHash: team ? await checksum(team) : null,
    execution,
    policyRevision: shared.record.revision,
    connectionId: target.connectionId,
    targetId: target.id,
    binding,
    ledgerSchema: target.ledgerSchema,
    track: target.track ?? "main",
    pinnedRelease: target.pinnedRelease ?? null,
    releases: chain.map((release) => release.id),
    changes: plan.open.map((change) => change.id),
    database: target.database,
    schema: target.schema ?? null,
    production: target.production,
    from: target.release,
    reference,
    sql,
  });
  const hash = await checksum(reviewArtifact);
  const rules = shared.record.policy.delivery ?? null;
  const sources =
    rules?.testFirst && target.production
      ? await promotionSources(target, stored, project)
      : { promotion: [], problems: [] };
  const delivery = rules
    ? await checkDelivery(
        runRequest(repo, project, target, connection, reviewArtifact, sources.promotion),
      )
    : null;
  return {
    target,
    from,
    to,
    reference,
    releases: chain,
    steps: plan.steps,
    changes: plan.open,
    differences,
    drift,
    sql,
    reviewToken: `${Date.now()}:${hash}`,
    binding,
    risks: [...new Set(chain.flatMap(releaseRisks))],
    policy: shared.record,
    reviewArtifact,
    delivery,
    promotion: sources.promotion,
    promotionProblems: sources.problems,
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
  if (plan.drift.length)
    throw new Error(
      `Direkte Datenbankänderungen erkannt (${plan.drift.map((item) => item.label).join(", ")}). Bitte zuerst prüfen und zusammenführen.`,
    );
  if (!plan.releases.length) return;
  const id = await versioningRun(
    runRequest(repo, project, plan.target, connection, plan.reviewArtifact, plan.promotion),
  );
  for (;;) {
    const status = await versioningRunStatus(id);
    onProgress?.(`${target.name}: ${status.release || "Wird geprüft"}`);
    if (status.status === "failed")
      throw new Error(status.error ?? "Ausführung fehlgeschlagen. Datenbankjournal prüfen.");
    if (status.status === "succeeded") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export function snapshotPayload(
  entry: ObjectSnapshot,
  target: DatabaseTarget,
  definition?: string,
) {
  return {
    schema: target.schema || entry.object.selection.schema,
    sourceSchema: entry.object.selection.schema,
    name: entry.object.selection.objectName,
    kind: entry.object.selection.objectType,
    ...(entry.object.metadataVersion === undefined
      ? {}
      : { metadataVersion: entry.object.metadataVersion }),
    definition: definition ?? entry.definition,
  };
}

function touchPayload(
  id: string,
  change: Change,
  step: DatabaseRelease,
  map: Map<string, DatabaseRelease>,
  to: DatabaseRelease,
  history: ReturnType<typeof objectHistory>,
  target: DatabaseTarget,
) {
  const owner = change.release ? map.get(change.release) : undefined;
  const parent = owner ? map.get(releaseParents(owner)[0] ?? "") : undefined;
  const find = (release: DatabaseRelease | undefined) =>
    release?.objects.find((entry) => entry.object.id === id);
  const meta = find(owner) ?? find(parent) ?? find(to) ?? find(step);
  if (!meta) throw new Error(`Berührtes Objekt ${id} ist in keinem Release beschrieben.`);
  const expected = change.before[id];
  if (!(id in change.before)) return { id, expect: "check", ...snapshotPayload(meta, target, "") };
  if (expected === null) return { id, expect: "absent", ...snapshotPayload(meta, target, "") };
  const definition = history(id, expected)?.definition;
  if (!definition)
    throw new Error(`Vorher-Stand von ${id} aus ${change.id} ist in keinem Release enthalten.`);
  return { id, expect: "definition", ...snapshotPayload(meta, target, definition) };
}

export async function captureTolerant(
  connection: SavedConnection,
  target: DatabaseTarget,
  objects: ObjectSnapshot[],
) {
  const result: ObjectSnapshot[] = [];
  for (const entry of objects) {
    try {
      result.push(await captureObject(connection, target.database, entry.object, target.schema));
    } catch {}
  }
  return result;
}

export function closureObjects(
  release: DatabaseRelease,
  actual: ObjectSnapshot[],
): AppliedObject[] {
  const found = new Map(actual.map((entry) => [entry.object.id, entry.checksum]));
  return release.objects
    .filter((entry) => found.get(entry.object.id) === entry.checksum)
    .map((entry) => ({ id: entry.object.id, hash: entry.checksum, change: null }));
}

async function ensureLedger(
  connection: SavedConnection,
  project: VersioningProject,
  target: DatabaseTarget,
  from: DatabaseRelease,
  map: Map<string, DatabaseRelease>,
  standalone: Map<string, StandaloneChange>,
  state: { STATUS: string },
  confirmed = false,
): Promise<ChangeLedger> {
  const current = await readChangeLedger(connection, project, target);
  if (current && state.STATUS === LEDGER_READY) return current;
  if (current?.changes.size && state.STATUS !== LEDGER_READY)
    throw new Error(
      "Eine ältere l8db-Version hat dieses Ziel verändert. Stand abgleichen, bevor weiter ausgerollt wird.",
    );
  const closure = releaseClosure(map, from.id, standalone);
  const data = closure.changes.filter((change) => change.data);
  if (data.length && !confirmed)
    throw new Error(
      `Abhakliste anlegen: Bitte bestätigen, dass die Datenänderungen ${data
        .map((change) => change.id)
        .join(", ")} in dieser Datenbank bereits gelaufen sind (Kunden → Abhakliste übernehmen).`,
    );
  const actual = await captureTolerant(connection, target, from.objects);
  await adoptLedger(
    connection,
    project,
    target,
    from,
    closure.changes,
    closureObjects(from, actual),
  );
  const adopted = await readChangeLedger(connection, project, target);
  if (!adopted) throw new Error("Abhakliste konnte nicht angelegt werden.");
  return adopted;
}

export async function adoptTarget(
  repo: string,
  project: VersioningProject,
  target: DatabaseTarget,
  connection: SavedConnection,
) {
  if (connection.readOnly) throw new Error("Die Zielverbindung ist schreibgeschützt.");
  target = (await sharedTarget(connection, project, target)).target;
  const state = await readLedger(connection, project, target);
  if (!state || !isReady(state.STATUS) || state.LEASE)
    throw new Error("Datenbank-Historie ist ungeklärt. Stand zuerst abgleichen.");
  const releases = await loadReleases(repo, project);
  const map = new Map(releases.map((release) => [release.id, release]));
  const from = map.get(state.RELEASE_ID);
  if (!from || (await releaseHash(from)) !== state.RELEASE_HASH)
    throw new Error(`Der Datenbankstand ${state.RELEASE_ID} fehlt im Repository.`);
  return ensureLedger(
    connection,
    project,
    target,
    from,
    map,
    await loadStandaloneChanges(repo, project),
    state,
    true,
  );
}

export async function recordBaseline(
  connection: SavedConnection,
  project: VersioningProject,
  target: DatabaseTarget,
  release: DatabaseRelease,
  changes: Change[],
  objects: AppliedObject[],
) {
  const ledger = await readChangeLedger(connection, project, target);
  const missing = changes.filter((change) => !ledger?.changes.has(change.id));
  await writeChangeLedger(
    connection,
    project,
    target,
    [
      ...changeRows(project, target, missing, "baseline", release.id, null),
      ...objectRows(project, target, objects),
    ],
    objects.map((entry) => entry.id),
  );
}

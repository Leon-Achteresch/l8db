import type { SavedConnection } from "@/lib/connections";
import { versioningRunFleet, versioningRunStatus } from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { control } from "./control";
import { assertReviewedToken, type DeploymentPlan, planDeployment } from "./deploy";
import { readTargets } from "./repository";
import type { DatabaseTarget, VersioningProject } from "./types";

export interface FleetResult {
  target: DatabaseTarget;
  plan: DeploymentPlan | null;
  error: string | null;
}

export async function preflightFleet(
  repo: string,
  project: VersioningProject,
  targets: DatabaseTarget[],
  connections: SavedConnection[],
  releaseId: string,
): Promise<FleetResult[]> {
  if (!targets.length) throw new Error("Mindestens eine Datenbank auswählen.");
  const results: FleetResult[] = [];
  const identities = new Set<string>();
  for (const target of targets) {
    try {
      const connection = connections.find((connection) => connection.id === target.connectionId);
      if (!connection) throw new Error("Zielverbindung fehlt.");
      const plan = await planDeployment(repo, project, target, connection, releaseId);
      if (plan.differences.some((difference) => difference.status !== "unchanged"))
        throw new Error("Direkte Datenbankänderungen erkannt. Stand zuerst abgleichen.");
      const identity = plan.binding.physicalKey ?? plan.binding.fingerprint;
      if (identities.has(identity))
        throw new Error(
          "Dieselbe physische Datenbank und dasselbe Schema wurden mehrfach ausgewählt.",
        );
      identities.add(identity);
      results.push({ target, plan, error: null });
    } catch (error) {
      results.push({ target, plan: null, error: String(error) });
    }
  }
  return results;
}

export async function deployFleet(
  repo: string,
  project: VersioningProject,
  reviewed: DeploymentPlan[],
  connections: SavedConnection[],
  releaseId: string,
  onProgress?: (message: string) => void,
  waveLimit = 1000,
) {
  const { store } = await readTargets(repo, project.id);
  const targets = reviewed.map((plan) => {
    const target = store.targets.find((target) => target.id === plan.target.id);
    if (!target) throw new Error("Ein freigegebenes Datenbankziel wurde entfernt.");
    return target;
  });
  const preflight = await preflightFleet(repo, project, targets, connections, releaseId);
  for (const [index, result] of preflight.entries()) {
    if (!result.plan || result.error) throw new Error(`${result.target.name}: ${result.error}`);
    assertReviewedToken(reviewed[index].reviewToken, result.plan.reviewToken);
    const connection = connections.find((item) => item.id === result.target.connectionId);
    if (!connection) throw new Error("Zielverbindung fehlt.");
    if (result.plan.releases.length)
      await control(connection, project, result.target, "authorize", {
        revision: result.plan.policy.revision,
        artifact: result.plan.reviewToken.split(":")[1],
      });
  }
  if (!Number.isInteger(waveLimit) || waveLimit < 1 || waveLimit > 1000)
    throw new Error("Ungültige Wellengröße.");
  const wave = preflight
    .flatMap((entry) => (entry.plan?.releases.length ? [entry.plan] : []))
    .slice(0, waveLimit);
  if (!wave.length) return;
  const requests = wave.map((plan) => {
    const connection = connections.find((item) => item.id === plan.target.connectionId);
    if (!connection) throw new Error("Zielverbindung fehlt.");
    return {
      repo,
      targetId: plan.target.id,
      runId: crypto.randomUUID(),
      artifact: plan.reviewArtifact,
      connection: {
        kind: connection.kind,
        connectionString: effectiveConnectionString(connection),
        database: plan.target.database,
        schema: plan.target.ledgerSchema,
        projectId: project.id,
        readOnly: connection.readOnly ?? false,
      },
    };
  });
  const id = await versioningRunFleet(requests);
  for (;;) {
    const status = await versioningRunStatus(id);
    const target = wave.find((entry) => entry.target.id === status.targetId)?.target;
    onProgress?.(
      `${target?.name ?? "Rollout"}: ${status.status === "running" ? "Wird ausgeführt" : "Abgeschlossen"}`,
    );
    if (status.status === "failed")
      throw new Error(status.error ?? "Rollout fehlgeschlagen. Datenbankjournal prüfen.");
    if (status.status === "succeeded") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

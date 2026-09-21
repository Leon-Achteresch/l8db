import type { SavedConnection } from "@/lib/connections";
import { assertReviewedToken, type DeploymentPlan, deploy, planDeployment } from "./deploy";
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
  }
  for (const plan of reviewed) {
    if (!plan.releases.length) continue;
    const connection = connections.find((connection) => connection.id === plan.target.connectionId);
    if (!connection) throw new Error("Zielverbindung fehlt.");
    await deploy(
      repo,
      project,
      plan.target.id,
      connection,
      releaseId,
      plan.reviewToken,
      onProgress,
    );
  }
}

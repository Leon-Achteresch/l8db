import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { versioningDelivery, versioningRepository } from "@/lib/db";
import { effectiveConnectionString, ensureSshTunnel } from "@/lib/ssh";
import type {
  DatabaseTarget,
  DeliveryRules,
  RemoteStatus,
  TargetStage,
  VersioningProject,
} from "./types";

export interface DeliveryEvidence {
  release: string;
  commit: string;
  number: number;
  url: string;
  author: string;
  approvals: string[];
}

export interface DeliveryGate {
  id: "repository" | "merged" | "review" | "test";
  ok: boolean;
  detail: string;
  evidence: DeliveryEvidence[];
}

export interface DeliveryReport {
  rules: DeliveryRules | null;
  gates: DeliveryGate[];
}

export interface Promotion {
  targetId: string;
  connection: ReturnType<typeof connectionPayload>;
}

export const GATE_LABELS: Record<DeliveryGate["id"], string> = {
  repository: "Repository",
  merged: "Im Hauptbranch",
  review: "Review",
  test: "Vorher auf Test",
};

export const STAGE_LABELS: Record<TargetStage, string> = {
  development: "Entwicklung",
  test: "Test",
  production: "Produktion",
};

export function targetStage(target: Pick<DatabaseTarget, "production" | "stage" | "environment">) {
  if (target.production) return "production";
  if (target.stage) return target.stage;
  return /dev|entw/i.test(target.environment ?? "") ? "development" : "test";
}

export function connectionPayload(
  connection: SavedConnection,
  project: VersioningProject,
  target: DatabaseTarget,
) {
  return {
    kind: connection.kind,
    connectionString: effectiveConnectionString(connection),
    database: target.database,
    schema: target.ledgerSchema || target.schema || project.objects[0]?.selection.schema,
    projectId: project.id,
    readOnly: connection.readOnly ?? false,
  };
}

export async function promotionSources(
  target: DatabaseTarget,
  targets: DatabaseTarget[],
  project: VersioningProject,
) {
  const promotion: Promotion[] = [];
  const problems: string[] = [];
  if (!target.production || !target.customer) return { promotion, problems };
  for (const candidate of targets) {
    if (candidate.production || candidate.customer !== target.customer) continue;
    if (candidate.stage !== "test") {
      if (!candidate.stage && targetStage(candidate) === "test")
        problems.push(`${candidate.name}: Stufe „Test“ in den Zieldetails festlegen`);
      continue;
    }
    const current = () =>
      useConnectionsStore
        .getState()
        .connections.find((entry) => entry.id === candidate.connectionId);
    const connection = current();
    if (!connection) {
      problems.push(`${candidate.name}: lokale Verbindung fehlt`);
      continue;
    }
    const tunnel = await ensureSshTunnel(connection);
    if (!tunnel.ok) {
      problems.push(`${candidate.name}: ${tunnel.error ?? "Tunnel nicht verbunden"}`);
      continue;
    }
    try {
      promotion.push({
        targetId: candidate.id,
        connection: connectionPayload(current() ?? connection, project, candidate),
      });
    } catch (error) {
      problems.push(`${candidate.name}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return { promotion, problems };
}

export function runRequest(
  repo: string,
  project: VersioningProject,
  target: DatabaseTarget,
  connection: SavedConnection,
  artifact: string,
  promotion: Promotion[],
) {
  return {
    repo,
    targetId: target.id,
    runId: crypto.randomUUID(),
    artifact,
    connection: connectionPayload(connection, project, target),
    promotion,
  };
}

export function checkDelivery(request: ReturnType<typeof runRequest>) {
  return versioningDelivery<DeliveryReport>(request);
}

export function blockingGate(report: DeliveryReport | null) {
  return report?.gates.find((gate) => !gate.ok) ?? null;
}

export function remoteStatus(repo: string) {
  return versioningRepository<RemoteStatus>({ action: "remote", repo });
}

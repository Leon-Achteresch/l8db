import type { SavedConnection } from "@/lib/connections";
import { supports } from "@/lib/providers";
import type { MultiTarget } from "./run";

export function compatibleConnections(
  active: SavedConnection | null,
  connections: SavedConnection[],
): SavedConnection[] {
  if (!active || !supports(active, "multi_target_query")) return [];
  return connections
    .filter((connection) => connection.kind === active.kind)
    .sort((left, right) =>
      left.id === active.id ? -1 : right.id === active.id ? 1 : left.name.localeCompare(right.name),
    );
}

export function targetLabel(target: MultiTarget, connections: SavedConnection[]): string {
  const connection = connections.find((entry) => entry.id === target.connectionId);
  return [connection?.name ?? "Unbekannte Verbindung", target.database, target.schema]
    .filter(Boolean)
    .join(" · ");
}

export {
  createLimiter,
  isMultiTargetCancelled,
  type Limiter,
  MultiTargetCancelled,
} from "./limiter";
export { type MergeOutcome, mergeResults, TARGET_COLUMN } from "./merge";
export {
  clampConcurrency,
  emptyRun,
  MULTI_TARGET_MAX_CONCURRENCY,
  MULTI_TARGET_MAX_ROWS,
  MULTI_TARGET_PER_SERVER_LIMIT,
  type MultiTarget,
  type MultiTargetExecutor,
  type MultiTargetRequest,
  type MultiTargetRunHandle,
  multiTarget,
  PARTIAL_SCRIPT_NOTICE,
  startMultiTargetRun,
  type TargetRun,
  type TargetStatus,
  targetId,
  UNSUPPORTED_CANCEL_NOTICE,
} from "./run";
export {
  type GatedTarget,
  MISSING_TARGET_REASON,
  type MultiTargetGate,
  multiTargetGate,
  OTHER_FAMILY_REASON,
  READ_ONLY_TARGET_REASON,
} from "./safety";

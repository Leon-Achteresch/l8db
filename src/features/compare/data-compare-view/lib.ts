import type { DataCompareSideSelection } from "@/features/compare/data-compare-side-picker";
import type { SavedConnection } from "@/lib/connections";
import { useDbSelectionStore } from "@/lib/db-selection";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sideLabel(
  side: DataCompareSideSelection,
  connection: SavedConnection | null,
): string {
  if (!connection || !side.schema || !side.table) return "–";
  return `${connection.name} · ${side.database ?? ""} · ${side.schema}.${side.table}`;
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function selectScriptTarget(target: DataCompareSideSelection): string | null {
  const connectionId = target.connectionId;
  if (!connectionId) return null;
  if (target.database) {
    useDbSelectionStore.getState().setDatabase(connectionId, target.database);
    return connectionId;
  }
  useDbSelectionStore.setState((state) => {
    const databaseByConnection = { ...state.databaseByConnection };
    delete databaseByConnection[connectionId];
    return { databaseByConnection };
  });
  return connectionId;
}

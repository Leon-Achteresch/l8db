import type { SavedConnection } from "@/lib/connections";
import { capabilitiesFor } from "@/lib/providers";

export type CompareObjectType =
  | "table"
  | "view"
  | "materialized_view"
  | "routine"
  | "procedure"
  | "package"
  | "sequence";

export interface CompareSideSelection {
  connectionId: string | null;
  database: string | null;
  schema: string | null;
  objectType: CompareObjectType;
  objectName: string | null;
  objectOid: string | null;
}

export const EMPTY_COMPARE_SIDE: CompareSideSelection = {
  connectionId: null,
  database: null,
  schema: null,
  objectType: "table",
  objectName: null,
  objectOid: null,
};

export const COMPARE_OBJECT_LABELS: Record<CompareObjectType, string> = {
  table: "Tabelle",
  view: "View",
  materialized_view: "Materialized View",
  routine: "Funktion",
  procedure: "Prozedur",
  package: "Package",
  sequence: "Sequenz",
};

export function supportedCompareObjectTypes(
  connection: SavedConnection | null,
): CompareObjectType[] {
  if (!connection) return [];
  const capabilities = capabilitiesFor(connection.kind);
  const types: CompareObjectType[] = ["table"];
  if (capabilities.views) types.push("view");
  if (capabilities.materialized_views) types.push("materialized_view");
  if (capabilities.functions) types.push("routine");
  if (capabilities.procedures) types.push("procedure");
  if (capabilities.compile_objects) types.push("package");
  if (capabilities.sequences) types.push("sequence");
  return types;
}

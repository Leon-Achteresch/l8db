import type { DatabaseKind } from "@/lib/db";

export function xlsxFullExportSupported(kind: DatabaseKind | null | undefined): boolean {
  return kind === "postgres";
}

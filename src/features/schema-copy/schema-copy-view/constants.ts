import type { SchemaCopyObjectType } from "@/lib/db";

export function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "missing") return "default";
  if (status === "different") return "secondary";
  return "outline";
}

export function statusLabel(status: string): string {
  if (status === "missing") return "fehlt im Ziel";
  if (status === "different") return "abweichend";
  return "identisch";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const MAX_DATA_ROWS = 100_000;

export const OBJECT_TYPES: { value: SchemaCopyObjectType; label: string }[] = [
  { value: "table", label: "Tabellen" },
  { value: "view", label: "Views" },
  { value: "routine", label: "Funktionen & Prozeduren" },
  { value: "package", label: "Packages" },
];

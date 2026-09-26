import { isReadOnlyConnection, useActiveConnection } from "@/lib/connections";
import { effectiveConnectionString } from "@/lib/ssh";

export function useStorageConnection() {
  const connection = useActiveConnection();
  let url = "";
  try {
    url = connection ? effectiveConnectionString(connection) : "";
  } catch {
    url = "";
  }
  return { connection, url, readOnly: isReadOnlyConnection(connection) };
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("de-DE");
}

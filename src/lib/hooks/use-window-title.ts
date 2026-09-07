import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";

export const APP_TITLE = "l8db";

export function formatWindowTitle(
  connectionName: string | null | undefined,
  database: string | null | undefined,
): string {
  const connection = connectionName?.trim();
  if (!connection) return APP_TITLE;
  const db = database?.trim();
  const context = db ? `${connection} · ${db}` : connection;
  return `${context} – ${APP_TITLE}`;
}

export function useWindowTitle() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const title = formatWindowTitle(connection?.name, database);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const window = getCurrentWindow();
        if (!cancelled) await window.setTitle(title);
      } catch {
        return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [title]);
}

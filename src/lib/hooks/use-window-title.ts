import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { type ConnectionEnvironment, useConnectionsStore } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { useConnectionEnvironment } from "@/lib/environments";
import { useFocusedConnection } from "@/lib/hooks/use-focused-connection";

export const APP_TITLE = "l8db";

const TITLE_ENVIRONMENTS: Partial<Record<ConnectionEnvironment, string>> = {
  production: "PROD",
  staging: "STAGING",
};

export function formatWindowTitle(
  connectionName: string | null | undefined,
  database: string | null | undefined,
  environment?: ConnectionEnvironment | null,
): string {
  const connection = connectionName?.trim();
  if (!connection) return APP_TITLE;
  const db = database?.trim();
  const prefix = environment ? TITLE_ENVIRONMENTS[environment] : undefined;
  const context = [prefix, connection, db].filter(Boolean).join(" · ");
  return `${context} – ${APP_TITLE}`;
}

export function useWindowTitle() {
  const connection = useFocusedConnection();
  const activeId = useConnectionsStore((state) => state.activeId);
  const database = useActiveDatabase();
  const environment = useConnectionEnvironment(connection)?.value;
  const title = formatWindowTitle(
    connection?.name,
    connection?.id === activeId ? database : null,
    environment,
  );

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

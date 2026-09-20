import type { Page } from "playwright";
import { seedApp } from "./perf-app";

export async function installVersioningLab(page: Page, repo: string) {
  await seedApp(page, 0);
  await page.addInitScript(
    ({ repo }) => {
      const connection = (id: string, kind: "postgres" | "oracle", database: string) => ({
        id,
        name: id,
        kind,
        connectionString:
          kind === "oracle"
            ? "oracle://lab@127.0.0.1:55441/FREEPDB1"
            : `postgresql://lab@127.0.0.1:55440/${database}`,
        sslMode: "disable",
      });
      localStorage.setItem(
        "l8db.connections",
        JSON.stringify({
          state: {
            connections: [
              connection("Development", "postgres", "l8db_versioning_dev"),
              connection("Kunde A", "postgres", "l8db_versioning_a"),
              connection("Kunde B", "postgres", "l8db_versioning_b"),
              connection("Oracle Lab", "oracle", ""),
            ],
            activeId: "Development",
            favoriteServerKeys: [],
            serverOrder: [],
          },
          version: 0,
        }),
      );
      localStorage.setItem(
        "l8db.db-selection",
        JSON.stringify({
          state: { database: "l8db_versioning_dev", schema: "public" },
          version: 0,
        }),
      );
      localStorage.setItem(
        "l8db.table-tabs",
        JSON.stringify({ state: { tabsByConnection: {} }, version: 4 }),
      );
      localStorage.setItem("l8db.versioning.repo", repo);
      const host = window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
        };
      };
      const original = host.__TAURI_INTERNALS__.invoke;
      const commands = new Set([
        "versioning_repository",
        "list_providers",
        "list_databases",
        "list_schemas",
        "list_tables",
        "list_all_columns",
        "list_views",
        "list_functions",
        "list_procedures",
        "list_sequences",
        "get_function_definition",
        "get_view_definition",
        "list_table_columns_detailed",
        "list_constraints",
        "list_indexes",
        "list_triggers",
        "list_compile_errors",
        "list_invalid_objects",
        "execute_script",
        "execute_query",
        "validate_sql",
        "begin_transaction",
        "execute_in_transaction",
        "commit_transaction",
        "rollback_transaction",
        "list_transactions",
        "test_connection_string",
      ]);
      host.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
        if (!commands.has(command)) return original(command, args);
        const request = { ...args };
        if (
          !request.database &&
          typeof request.connectionString === "string" &&
          request.connectionString.startsWith("postgres")
        )
          request.database = new URL(request.connectionString).pathname.slice(1);
        const response = await fetch("http://127.0.0.1:55449", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ command, args: request }),
        });
        const result = await response.json();
        if (result.error) throw new Error(result.error);
        return result.result;
      };
    },
    { repo },
  );
}

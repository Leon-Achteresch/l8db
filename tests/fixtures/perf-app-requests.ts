import type { Page } from "playwright";

export const DATABASE_REQUEST_COMMANDS = [
  "test_connection",
  "test_connection_string",
  "list_databases",
  "list_schemas",
  "list_tables",
  "list_views",
  "list_materialized_views",
  "list_all_columns",
  "list_table_columns_detailed",
  "list_import_columns",
  "list_functions",
  "list_procedures",
  "list_sequences",
  "list_roles",
  "list_proxy_users",
  "list_role_privileges",
  "list_foreign_keys",
  "list_triggers",
  "list_indexes",
  "list_constraints",
  "list_extensions",
  "list_available_extensions",
  "list_invalid_objects",
  "list_compile_errors",
  "list_object_grants",
  "list_used_by",
  "list_synonyms",
  "list_scheduler_jobs",
  "list_publications",
  "list_subscriptions",
  "list_sessions",
  "list_locks",
  "list_enums",
  "list_schema_copy_objects",
  "search_columns",
  "search_source",
  "fetch_table_rows",
  "count_table_rows",
  "count_table_rows_capped",
  "execute_query",
  "execute_query_with_params",
  "execute_in_transaction",
  "execute_in_transaction_with_params",
  "execute_script",
  "explain_query",
  "describe_query_columns",
  "get_table_ddl",
  "get_view_definition",
  "get_database_overview",
  "get_er_schema",
  "get_partition_info",
  "get_table_rls",
  "get_function_definition",
  "get_procedure_definition",
  "get_sequence_definition",
  "table_comment",
  "column_value_options",
  "object_audit_info",
  "schema_catalog",
  "schema_partition_ddl",
  "update_row",
  "update_view_definition",
  "begin_transaction",
  "commit_transaction",
  "rollback_transaction",
  "cancel_execution",
] as const;

const IPC_COMMANDS = new Set([
  "mcp_take_open_requests",
  "mcp_dashboards",
  "automation_ai_activity",
  "list_providers",
  "load_secret",
  "store_secret",
  "delete_secret",
  "configure_execution_defaults",
  "set_crash_reporting",
  "community_extension_store",
  "mcp_config",
  "automation_sync_connections",
  "automation_get_settings",
  "automation_save_settings",
  "branching_schedules",
  "list_transactions",
  "check_update",
  "plugin:event|listen",
  "plugin:app|version",
  "plugin:window|set_title",
  "plugin:path|resolve_directory",
  "plugin:log|log",
  "plugin:dialog|open",
  "plugin:dialog|save",
  "plugin:fs|read_text_file",
  "plugin:fs|write_text_file",
]);

const DATABASE_COMMANDS = new Set<string>(DATABASE_REQUEST_COMMANDS);

export interface AppRequestSnapshot {
  calls: string[];
  activeDatabaseRequests: number;
  maxDatabaseConcurrency: number;
}

export function requestCounts(commands: readonly string[]) {
  const database: Record<string, number> = {};
  const ipc: Record<string, number> = {};
  const unknown: Record<string, number> = {};
  for (const command of commands) {
    const histogram = DATABASE_COMMANDS.has(command)
      ? database
      : IPC_COMMANDS.has(command)
        ? ipc
        : unknown;
    histogram[command] = (histogram[command] ?? 0) + 1;
  }
  return {
    database,
    ipc,
    unknown,
    databaseRequests: Object.values(database).reduce((sum, count) => sum + count, 0),
    ipcRequests: Object.values(ipc).reduce((sum, count) => sum + count, 0),
    unknownRequests: Object.values(unknown).reduce((sum, count) => sum + count, 0),
  };
}

export async function installAppRequestProbe(page: Page) {
  await page.addInitScript(
    (databaseCommands) => {
      const database = new Set<string>(databaseCommands);
      const state = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> };
        __perfAppRequests: AppRequestSnapshot;
      };
      const invoke = state.__TAURI_INTERNALS__.invoke;
      const probe: AppRequestSnapshot = {
        calls: [],
        activeDatabaseRequests: 0,
        maxDatabaseConcurrency: 0,
      };
      state.__perfAppRequests = probe;
      state.__TAURI_INTERNALS__.invoke = (command, args) => {
        probe.calls.push(command);
        if (!database.has(command)) return invoke(command, args);
        probe.activeDatabaseRequests++;
        probe.maxDatabaseConcurrency = Math.max(
          probe.maxDatabaseConcurrency,
          probe.activeDatabaseRequests,
        );
        return invoke(command, args).finally(() => probe.activeDatabaseRequests--);
      };
    },
    [...DATABASE_REQUEST_COMMANDS],
  );
}

export async function appRequestSnapshot(page: Page): Promise<AppRequestSnapshot> {
  return page.evaluate(() => {
    const state = window as unknown as { __perfAppRequests: AppRequestSnapshot };
    return {
      calls: [...state.__perfAppRequests.calls],
      activeDatabaseRequests: state.__perfAppRequests.activeDatabaseRequests,
      maxDatabaseConcurrency: state.__perfAppRequests.maxDatabaseConcurrency,
    };
  });
}

export async function waitForAppMetadata(page: Page, requiredCommands: readonly string[]) {
  await page.waitForFunction((commands) => {
    const probe = (window as unknown as { __perfAppRequests: AppRequestSnapshot })
      .__perfAppRequests;
    return (
      probe.activeDatabaseRequests === 0 &&
      commands.every((command) => probe.calls.includes(command))
    );
  }, requiredCommands);
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

export function requestsSince(before: AppRequestSnapshot, after: AppRequestSnapshot) {
  return requestCounts(after.calls.slice(before.calls.length));
}

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/lib/settings";
import { requestSqlConfirmation } from "@/lib/sql-confirmation";
import { destructiveStatements } from "@/lib/sql-safety";
import { finishTask, startTask, updateTask } from "@/lib/tasks";
import { cancelTableExport, type TableExportProgress, type TableExportRequest } from "./columns";
import type { DatabaseKind } from "./providers";

export interface QueryExecutionOptions {
  jobId?: string;
  onJob?: (id: string) => void;
  confirmed?: boolean;
  track?: boolean;
}

const SQL_COMMANDS = new Set([
  "execute_query",
  "execute_query_with_params",
  "execute_in_transaction",
  "execute_in_transaction_with_params",
  "execute_script",
]);
const CONFIGURED_COMMANDS = new Set([
  ...SQL_COMMANDS,
  "test_connection",
  "test_connection_string",
  "list_databases",
  "list_schemas",
  "fetch_table_rows",
  "count_table_rows",
  "count_table_rows_capped",
  "begin_transaction",
  "open_ssh_tunnel",
  "open_proxy_tunnel",
  "csv_import",
  "copy_table_to_connection",
]);

const WRITE_COMMANDS = new Set([
  "debug_launch",
  "debug_action",
  "add_column",
  "alter_column",
  "alter_role",
  "alter_sequence",
  "attach_partition",
  "begin_transaction",
  "cancel_session",
  "compile_object",
  "compile_invalid_objects",
  "create_materialized_view",
  "create_policy",
  "create_publication",
  "create_role",
  "create_schema",
  "create_subscription",
  "create_table",
  "csv_import",
  "delete_row_in_transaction",
  "detach_partition",
  "drop_column",
  "drop_materialized_view",
  "drop_policy",
  "drop_publication",
  "drop_role",
  "drop_schema",
  "drop_subscription",
  "drop_table",
  "duplicate_row_in_transaction",
  "execute_in_transaction",
  "copy_schema_table_data",
  "copy_table_to_connection",
  "execute_object_ddl",
  "execute_schema_object_copy",
  "execute_in_transaction_with_params",
  "insert_row_in_transaction",
  "install_extension",
  "modify_privilege",
  "refresh_materialized_view",
  "run_restore",
  "run_scheduler_job",
  "set_scheduler_job_enabled",
  "set_table_rls",
  "terminate_session",
  "truncate_table",
  "uninstall_extension",
  "update_row",
  "update_row_in_transaction",
  "update_view_definition",
]);

export const READ_ONLY_MESSAGE =
  "Lesemodus: Diese Verbindung ist schreibgeschützt. Modus in den Verbindungseinstellungen ändern und neu verbinden.";

let readOnlyResolver: (connectionString?: unknown) => boolean = () => false;

export function registerReadOnlyResolver(
  resolver: (connectionString?: unknown) => boolean,
): (connectionString?: unknown) => boolean {
  const previous = readOnlyResolver;
  readOnlyResolver = resolver;
  return previous;
}

export function isReadOnlyActive(connectionString?: unknown): boolean {
  try {
    return readOnlyResolver(connectionString);
  } catch {
    return false;
  }
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (WRITE_COMMANDS.has(command) && isReadOnlyActive(args?.connectionString)) {
    throw new Error(READ_ONLY_MESSAGE);
  }
  const settings = useSettingsStore.getState();
  const options = (args?.options ?? {}) as QueryExecutionOptions;
  let taskId: string | undefined;
  let backendOptions: Record<string, unknown> = {
    queryTimeout: settings.queryTimeout,
    connectionTimeout: settings.connectionTimeout,
    ...(options.jobId ? { jobId: options.jobId } : {}),
  };
  if (SQL_COMMANDS.has(command)) {
    const { operationContext } = await import("@/lib/operation-context");
    const context = operationContext(args ?? {});
    if (!options.confirmed)
      await confirmSqlExecution(
        context.kind as DatabaseKind,
        String(args?.connectionString ?? ""),
        String(args?.sql ?? ""),
        context.database ?? undefined,
        context.connectionName,
      );
    const jobId = options.jobId ?? crypto.randomUUID();
    backendOptions = { ...backendOptions, jobId };
    const { capabilitiesFor } = await import("@/lib/providers");
    const cancellable = context.kind
      ? capabilitiesFor(context.kind as DatabaseKind).query_cancel
      : false;
    if (options.track !== false)
      taskId = startTask(
        {
          id: jobId,
          title: command === "execute_script" ? "SQL-Skript" : "SQL-Abfrage",
          ...context,
        },
        cancellable ? () => cancelExecution(jobId) : undefined,
      );
    options.onJob?.(jobId);
  }
  let unlisten: (() => void) | undefined;
  const taskTitles: Record<string, string> = {
    export_table_csv: "CSV-Export",
    install_driver: "Treiberinstallation",
    execute_schema_object_copy: "Schema-Struktur kopieren",
    copy_schema_table_data: "Tabellendaten kopieren",
  };
  if (taskTitles[command]) {
    const { operationContext } = await import("@/lib/operation-context");
    const request = args?.request as TableExportRequest | undefined;
    taskId = startTask(
      {
        id: request?.jobId,
        title:
          command === "export_table_csv" && request?.format && request.format !== "csv"
            ? `${request.format.toUpperCase()}-Export`
            : taskTitles[command],
        ...operationContext(args ?? {}),
      },
      request?.jobId ? () => cancelTableExport(request.jobId) : undefined,
    );
    if (request?.jobId) {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<TableExportProgress>("table-export-progress", ({ payload }) => {
        if (payload.jobId === request.jobId && taskId)
          updateTask(taskId, { progress: payload.rows });
      }).catch(() => undefined);
    }
  }
  try {
    if (WRITE_COMMANDS.has(command) && isReadOnlyActive(args?.connectionString))
      throw new Error(READ_ONLY_MESSAGE);
    const result = await tauriInvoke<T>(
      command,
      CONFIGURED_COMMANDS.has(command) ? { ...args, options: backendOptions } : args,
    );
    unlisten?.();
    if (taskId) finishTask(taskId, result);
    return result;
  } catch (error) {
    unlisten?.();
    if (taskId) finishTask(taskId, undefined, error);
    throw error;
  }
}

export async function confirmSqlExecution(
  kind: DatabaseKind,
  connectionString: string,
  sql: string,
  database?: string,
  connectionName?: string,
): Promise<void> {
  if (!useSettingsStore.getState().confirmDestructiveQueries) return;
  const findings = destructiveStatements(sql, kind);
  if (!findings.length) return;
  const { operationContext } = await import("@/lib/operation-context");
  const context = operationContext({ kind, connectionString, database });
  const accepted = await requestSqlConfirmation({
    connection: connectionName ?? context.connectionName,
    database: database ?? context.database,
    statements: findings,
  });
  if (!accepted) throw new Error("Ausführung vom Benutzer abgebrochen.");
}

export async function configureExecutionDefaults(
  queryTimeout: number,
  connectionTimeout: number,
): Promise<void> {
  return invoke("configure_execution_defaults", { queryTimeout, connectionTimeout });
}

export async function cancelExecution(jobId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await invoke<boolean>("cancel_execution", { jobId })) return true;
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return false;
}

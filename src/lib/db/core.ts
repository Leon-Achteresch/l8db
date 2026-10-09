import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/lib/settings";
import { requestSqlConfirmation } from "@/lib/sql-confirmation";
import { destructiveStatements } from "@/lib/sql-safety";
import { finishTask, startTask, updateTask } from "@/lib/tasks";
import {
  recordDatabaseOperation,
  traceCommand,
  USAGE_COMMANDS,
  usageOutcome,
} from "@/lib/telemetry";
import { cancelTableExport, type TableExportProgress, type TableExportRequest } from "./columns";
import type { DatabaseKind } from "./providers";

export interface QueryExecutionOptions {
  jobId?: string;
  onJob?: (id: string) => void;
  confirmed?: boolean;
  track?: boolean;
  session?: string;
  pooled?: boolean;
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
  "list_tables",
  "list_views",
  "list_functions",
  "list_procedures",
  "fetch_table_rows",
  "count_table_rows",
  "count_table_rows_capped",
  "begin_transaction",
  "open_ssh_tunnel",
  "open_proxy_tunnel",
  "csv_import",
  "copy_table_to_connection",
  "run_transfer",
  "datagen_run",
]);

const WRITE_COMMANDS = new Set([
  "branching_run",
  "branching_update",
  "versioning_run",
  "versioning_run_fleet",
  "versioning_run_seed",
  "debug_launch",
  "debug_action",
  "add_column",
  "alter_column",
  "alter_role",
  "alter_sequence",
  "apply_constraint_change",
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
  "datagen_run",
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
  "run_transfer",
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
  "s3_create_bucket",
  "s3_delete_bucket",
  "s3_put_object_text",
  "s3_create_folder",
  "s3_delete_objects",
  "s3_delete_prefix",
  "s3_copy_objects",
  "s3_rename_object",
  "s3_restore_version",
  "s3_update_object_properties",
  "s3_put_config",
  "s3_delete_config",
  "s3_abort_multipart_upload",
  "s3_upload",
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

function needsProductionGuard(command: string): boolean {
  return (
    SQL_COMMANDS.has(command) || (WRITE_COMMANDS.has(command) && command !== "begin_transaction")
  );
}

function nestedConnectionString(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const connection = (value as { connection?: { connectionString?: unknown } }).connection;
  return typeof connection?.connectionString === "string" ? connection.connectionString : undefined;
}

function guardTargets(args: Record<string, unknown>): Record<string, unknown>[] {
  const nested = [
    nestedConnectionString(args.request),
    ...(Array.isArray(args.requests) ? args.requests.map(nestedConnectionString) : []),
  ].filter((value): value is string => Boolean(value) && value !== args.connectionString);
  return [args, ...nested.map((connectionString) => ({ ...args, connectionString }))];
}

async function readOnlyGuard(args: Record<string, unknown>): Promise<void> {
  const [{ operationConnections }, { isReadOnlyConnection }] = await Promise.all([
    import("@/lib/operation-context"),
    import("@/lib/connections"),
  ]);
  const targets = guardTargets(args);
  if (
    targets.some(
      (target) =>
        (target !== args && isReadOnlyActive(target.connectionString)) ||
        operationConnections(target, "exact").some(isReadOnlyConnection),
    )
  )
    throw new Error(READ_ONLY_MESSAGE);
}

async function productionGuard(command: string, args: Record<string, unknown>): Promise<void> {
  const sqlCommand = SQL_COMMANDS.has(command);
  const [{ operationConnections }, { productionWriteBlock }] = await Promise.all([
    import("@/lib/operation-context"),
    import("@/lib/environments"),
  ]);
  for (const target of guardTargets(args)) {
    for (const connection of operationConnections(target)) {
      const message = productionWriteBlock(connection, sqlCommand ? String(args.sql ?? "") : null);
      if (message) throw new Error(message);
    }
  }
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!Object.hasOwn(USAGE_COMMANDS, command)) return invokeCommand<T>(command, args);
  const started = performance.now();
  let failure: unknown;
  let failed = false;
  try {
    return await invokeCommand<T>(command, args);
  } catch (error) {
    failed = true;
    failure = error;
    throw error;
  } finally {
    recordDatabaseOperation(
      command,
      args?.kind,
      failed ? usageOutcome(failure ?? "unknown") : "ok",
      performance.now() - started,
    );
  }
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (WRITE_COMMANDS.has(command)) {
    if (isReadOnlyActive(args?.connectionString)) throw new Error(READ_ONLY_MESSAGE);
    await readOnlyGuard(args ?? {});
  }
  if (needsProductionGuard(command)) await productionGuard(command, args ?? {});
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
  const kind = typeof args?.kind === "string" ? args.kind : "unknown";
  try {
    if (WRITE_COMMANDS.has(command) && isReadOnlyActive(args?.connectionString))
      throw new Error(READ_ONLY_MESSAGE);
    const result = await traceCommand(command, { kind }, () =>
      tauriInvoke<T>(
        command,
        CONFIGURED_COMMANDS.has(command) ? { ...args, options: backendOptions } : args,
      ),
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
  const [{ operationContext }, { useConnectionsStore }, environments] = await Promise.all([
    import("@/lib/operation-context"),
    import("@/lib/connections/store"),
    import("@/lib/environments"),
  ]);
  const context = operationContext({ kind, connectionString, database });
  const connection = useConnectionsStore
    .getState()
    .connections.find((entry) => entry.id === context.connectionId);
  const production = environments.isProduction(connection);
  if (!production && !useSettingsStore.getState().confirmDestructiveQueries) return;
  const findings = destructiveStatements(sql, kind, { strict: production });
  if (!findings.length) return;
  const accepted = await requestSqlConfirmation({
    connection: connectionName ?? context.connectionName,
    database: database ?? context.database,
    statements: findings,
    confirmTexts: production
      ? environments.productionConfirmTexts(connection, database ?? context.database)
      : undefined,
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

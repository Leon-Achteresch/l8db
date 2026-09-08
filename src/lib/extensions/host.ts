import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { useConnectionsStore } from "@/lib/connections";
import { executeQuery, executeQueryWithParams, isReadOnlyActive } from "@/lib/db";
import { databaseFromConnectionString, useDbSelectionStore } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";
import { version } from "../../../package.json";
import type {
  CoreServices,
  DatabaseInfo,
  FetchOptions,
  ProcessOptions,
  ProcessResult,
  PromptKind,
  PromptRequest,
  PromptResult,
  QueryResult,
} from "./contracts";
import { ExtensionError } from "./contracts";
import { ExtensionManager } from "./manager";
import { useExtensionPrompts } from "./prompts";
import { SandboxRuntime } from "./sandbox-runtime";
import { TauriExtensionStorage } from "./tauri-storage";

const FETCH_BODY_LIMIT = 1024 * 1024;

async function runFetch(url: string, options: FetchOptions) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (!(key in headers)) headers[key] = value;
    });
    const text = await response.text();
    if (text.length > FETCH_BODY_LIMIT)
      throw new ExtensionError("ProtocolError", "Response body exceeds 1 MiB");
    return { status: response.status, headers, body: text };
  } catch (error) {
    if (error instanceof ExtensionError) throw error;
    throw new ExtensionError("NetworkError", String(error));
  } finally {
    clearTimeout(timer);
  }
}

export function createExtensionHost() {
  const database = (): DatabaseInfo | null => {
    const state = useConnectionsStore.getState();
    const connection = state.connections.find((c) => c.id === state.activeId);
    if (!connection) return null;
    return {
      connectionId: connection.id,
      name:
        useDbSelectionStore.getState().databaseByConnection[connection.id] ??
        databaseFromConnectionString(connection.connectionString) ??
        connection.name,
      kind: connection.kind,
    };
  };
  const core: CoreServices = {
    database,
    notify: (message) => toast.info(message),
    async query(request): Promise<QueryResult> {
      const state = useConnectionsStore.getState();
      const connection = state.connections.find((c) => c.id === state.activeId);
      if (!connection) throw new ExtensionError("DatabaseUnavailableError", "No active connection");
      if (request.write && isReadOnlyActive())
        throw new ExtensionError("PermissionDeniedError", "Read-only connection");
      const connectionString = effectiveConnectionString(connection);
      const databaseName =
        useDbSelectionStore.getState().databaseByConnection[connection.id] ?? undefined;
      try {
        const result =
          request.params === undefined
            ? await executeQuery(connection.kind, connectionString, request.sql, databaseName)
            : await executeQueryWithParams(
                connection.kind,
                connectionString,
                request.sql,
                request.params.map((p) => (typeof p === "string" ? p : null)),
                databaseName,
              );
        return {
          columns: result.columns,
          rows: result.rows,
          rowsAffected: result.rows_affected,
          executionTimeMs: result.execution_time_ms,
        };
      } catch (error) {
        throw new ExtensionError("QueryError", String(error));
      }
    },
    fetch(request) {
      return runFetch(request.url, request.options);
    },
    async clipboardRead() {
      try {
        return await navigator.clipboard.readText();
      } catch (error) {
        throw new ExtensionError("ClipboardError", String(error));
      }
    },
    async clipboardWrite(value) {
      try {
        await navigator.clipboard.writeText(value);
      } catch (error) {
        throw new ExtensionError("ClipboardError", String(error));
      }
    },
    async showOpenDialog(title) {
      const path = await open({ multiple: false, title });
      return typeof path === "string" ? path : null;
    },
    async showSaveDialog(filename) {
      const path = await save({ defaultPath: filename ?? undefined });
      return typeof path === "string" ? path : null;
    },
    async readTextFile(path) {
      try {
        return await readTextFile(path);
      } catch (error) {
        throw new ExtensionError("FilesystemError", String(error));
      }
    },
    async writeTextFile(path, contents) {
      try {
        await writeTextFile(path, contents);
      } catch (error) {
        throw new ExtensionError("FilesystemError", String(error));
      }
    },
    async runProcess(request: {
      command: string;
      options: ProcessOptions;
    }): Promise<ProcessResult> {
      try {
        return await tauriInvoke<ProcessResult>("extension_process_run", {
          command: request.command,
          options: request.options,
        });
      } catch (error) {
        throw new ExtensionError("ProcessError", String(error));
      }
    },
    prompt<T extends PromptKind>(request: PromptRequest & { kind: T }): Promise<PromptResult<T>> {
      return useExtensionPrompts.getState().request(request);
    },
  };
  const manager = new ExtensionManager(
    new TauriExtensionStorage(),
    new SandboxRuntime(),
    core,
    version,
  );
  let dispose: (() => void) | undefined;
  return {
    manager,
    async start() {
      if (dispose) return;
      await manager.discover();
      let previous: DatabaseInfo | null = null;
      let transitions = Promise.resolve();
      const update = () => {
        const current = database();
        if (JSON.stringify(current) === JSON.stringify(previous)) return;
        const closed = previous;
        previous = current;
        transitions = transitions
          .then(async () => {
            if (closed) manager.events.emit("databaseClosed", closed);
            if (current) {
              await manager.trigger("onDatabaseOpen");
              manager.events.emit("databaseOpened", current);
            }
            manager.events.emit("activeDatabaseChanged", current);
          })
          .catch((error) => manager.log("host", "error", String(error)));
      };
      const connections = useConnectionsStore.subscribe(update);
      const selections = useDbSelectionStore.subscribe(update);
      dispose = () => {
        connections();
        selections();
      };
      await manager.trigger("onStartup");
      update();
    },
    dispose() {
      dispose?.();
      dispose = undefined;
    },
  };
}

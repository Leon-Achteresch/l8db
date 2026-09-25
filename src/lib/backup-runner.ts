import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { appendLogLines, type BackupMode, formatBytes, progressPercent } from "@/lib/backup";
import type { SavedConnection } from "@/lib/connections";
import {
  type BackupLogEvent,
  type BackupOptions,
  type BackupOutcome,
  type BackupProgressEvent,
  cancelExecution,
  runBackup,
  runRestore,
} from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { finishTask, startTask, updateTask } from "@/lib/tasks";

interface BackupToolPathsState {
  paths: Record<string, string>;
  setPath: (tool: string, path: string) => void;
}

export const useBackupToolPaths = create<BackupToolPathsState>()(
  persist(
    (set) => ({
      paths: {},
      setPath: (tool, path) =>
        set((state) => {
          const paths = { ...state.paths };
          if (path.trim()) paths[tool] = path.trim();
          else delete paths[tool];
          return { paths };
        }),
    }),
    { name: "l8db.backup-tools", partialize: (state) => ({ paths: state.paths }) },
  ),
);

interface BackupJobState {
  logs: Record<string, string[]>;
  progress: Record<string, number | null>;
  outcomes: Record<string, BackupOutcome>;
  lastJob: Record<string, string>;
}

export const useBackupJobs = create<BackupJobState>()(() => ({
  logs: {},
  progress: {},
  outcomes: {},
  lastJob: {},
}));

export function backupScope(mode: BackupMode, connectionId: string, database: string | null) {
  return JSON.stringify([mode, connectionId, database]);
}

export interface BackupJobInput {
  mode: BackupMode;
  connection: SavedConnection;
  database: string | null;
  path: string;
  options: BackupOptions;
}

export async function runBackupJob(input: BackupJobInput): Promise<BackupOutcome> {
  const { mode, connection, database, path, options } = input;
  const id = crypto.randomUUID();
  const url = effectiveConnectionString(connection);
  let cancelled = false;
  let backendStarted = false;
  const label = mode === "backup" ? "Sicherung" : "Wiederherstellung";
  startTask(
    {
      id,
      title: `${label} · ${path.split(/[\\/]/).pop() || connection.name}`,
      connectionId: connection.id,
      connectionName: connection.name,
      database,
    },
    async () => {
      cancelled = true;
      return backendStarted ? cancelExecution(id) : true;
    },
  );
  useBackupJobs.setState((state) => ({
    logs: { ...state.logs, [id]: [] },
    progress: { ...state.progress, [id]: null },
    lastJob: { ...state.lastJob, [backupScope(mode, connection.id, database)]: id },
  }));
  const unlistenLog = await listen<BackupLogEvent>("backup-log", ({ payload }) => {
    if (payload.jobId !== id) return;
    useBackupJobs.setState((state) => ({
      logs: { ...state.logs, [id]: appendLogLines(state.logs[id] ?? [], payload.lines) },
    }));
    const last = payload.lines.at(-1);
    if (last) updateTask(id, { detail: last.slice(0, 300) });
  }).catch(() => () => {});
  const unlistenProgress = await listen<BackupProgressEvent>("backup-progress", ({ payload }) => {
    if (payload.jobId !== id) return;
    const percent = progressPercent(payload.done, payload.total);
    useBackupJobs.setState((state) => ({ progress: { ...state.progress, [id]: percent } }));
    if (percent !== null) updateTask(id, { progress: percent, total: 100 });
  }).catch(() => () => {});
  try {
    if (cancelled) throw new Error("Vorgang vom Benutzer abgebrochen.");
    backendStarted = true;
    const request = { path, options, toolPaths: useBackupToolPaths.getState().paths };
    const run = mode === "backup" ? runBackup : runRestore;
    const outcome = await run(connection.kind, url, database ?? undefined, request, id);
    useBackupJobs.setState((state) => ({ outcomes: { ...state.outcomes, [id]: outcome } }));
    updateTask(id, {
      detail: `${label} abgeschlossen${outcome.bytes != null ? ` · ${formatBytes(outcome.bytes)}` : ""}`,
    });
    finishTask(id, { path: outcome.path, command: outcome.command, bytes: outcome.bytes });
    return outcome;
  } catch (error) {
    finishTask(id, undefined, error);
    throw error;
  } finally {
    unlistenLog();
    unlistenProgress();
  }
}

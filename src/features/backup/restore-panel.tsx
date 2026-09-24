import { useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  defaultBackupOptions,
  restoreBlockReason,
  restoreConfirmationPhrase,
  restoreEffects,
  restoreToolFor,
} from "@/lib/backup";
import { backupScope, runBackupJob, useBackupJobs } from "@/lib/backup-runner";
import { connectionSummary } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import type { BackupOptions, BackupToolInfo } from "@/lib/db";
import { useCapabilities } from "@/lib/providers";
import { isConnectionQuery } from "@/lib/query-client";
import { isTaskActive, useTasksStore } from "@/lib/tasks";
import { BackupJobLog } from "./backup-job-log";
import { BackupOptionsFields } from "./backup-options-fields";
import { RestoreConfirmDialog } from "./restore-confirm-dialog";

interface RestorePanelProps {
  connection: SavedConnection;
  database: string | null;
  tools: BackupToolInfo[] | undefined;
}

export function RestorePanel({ connection, database, tools }: RestorePanelProps) {
  const kind = connection.kind;
  const caps = useCapabilities(kind);
  const queryClient = useQueryClient();
  const [options, setOptions] = useState<BackupOptions>(() =>
    defaultBackupOptions(kind, "restore"),
  );
  const [path, setPath] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = backupScope("restore", connection.id, database);
  const jobId = useBackupJobs((state) => state.lastJob[scope]);
  const running = useTasksStore((state) =>
    state.tasks.some((task) => task.id === jobId && isTaskActive(task)),
  );
  const blocked = restoreBlockReason(connection, caps);
  const required = restoreToolFor(kind);
  const missingTool =
    required && tools?.some((tool) => tool.name === required && !tool.path) ? required : null;
  const serverSide = kind === "mssql";
  const summary = connectionSummary(connection.connectionString, kind);
  const endpoint = [
    summary.host && summary.port
      ? `${summary.host}:${summary.port}`
      : summary.host || summary.database,
    connection.ssh?.host ? `über SSH ${connection.ssh.host}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const pick = async (directory: boolean) => {
    setError(null);
    try {
      const picked = await open({ directory, multiple: false });
      if (typeof picked === "string") setPath(picked);
    } catch (failure) {
      setError(String(failure));
    }
  };

  const start = async () => {
    setConfirming(false);
    setError(null);
    const previous = useBackupJobs.getState().lastJob[scope];
    try {
      await runBackupJob({ mode: "restore", connection, database, path, options });
      await queryClient.invalidateQueries({
        predicate: (query) => isConnectionQuery(query.queryKey, connection.id),
      });
    } catch (failure) {
      if (useBackupJobs.getState().lastJob[scope] === previous) setError(String(failure));
    }
  };

  if (blocked) {
    return (
      <p
        role="alert"
        className="max-w-2xl rounded-md border border-destructive/40 p-3 text-sm text-destructive"
      >
        {blocked}
      </p>
    );
  }

  return (
    <div className="grid max-w-4xl gap-5">
      <div className="grid gap-1 rounded-md border bg-muted/30 p-3 text-xs">
        <span className="text-muted-foreground">Ziel der Wiederherstellung</span>
        <span className="font-medium">
          {connection.name} · <span className="font-mono">{database ?? "Standard-Datenbank"}</span>
        </span>
        <span className="font-mono text-muted-foreground">{endpoint}</span>
      </div>

      <div className="grid gap-1">
        <Label htmlFor="restore-path" className="text-xs">
          {serverSide ? "Sicherungsdatei auf dem Server" : "Sicherung"}
        </Label>
        <div className="flex gap-2">
          <Input
            id="restore-path"
            value={path}
            disabled={running}
            placeholder={serverSide ? "/var/opt/mssql/backup/app.bak" : "Datei wählen…"}
            className="h-8 font-mono text-xs"
            onChange={(event) => setPath(event.target.value)}
          />
          {!serverSide && (
            <Button variant="outline" size="sm" disabled={running} onClick={() => void pick(false)}>
              Datei wählen…
            </Button>
          )}
          {kind === "postgres" && (
            <Button variant="outline" size="sm" disabled={running} onClick={() => void pick(true)}>
              Verzeichnis wählen…
            </Button>
          )}
        </div>
        {kind === "postgres" && (
          <span className="text-[11px] text-muted-foreground">
            Format wird erkannt: SQL-Skripte laufen über psql, Custom/Tar/Verzeichnis über
            pg_restore. Löschen, Eigentümer- und Rechteoptionen gelten nur für pg_restore.
          </span>
        )}
        {kind === "mysql" && (
          <span className="text-[11px] text-muted-foreground">
            SQL-Datei wird über den mysql-Client in die gewählte Datenbank eingespielt.
          </span>
        )}
      </div>

      <BackupOptionsFields
        kind={kind}
        mode="restore"
        options={options}
        disabled={running}
        onChange={(patch) => setOptions((current) => ({ ...current, ...patch }))}
      />

      {missingTool && (
        <p role="alert" className="text-xs text-destructive">
          {missingTool} wurde nicht gefunden. Im Reiter „Werkzeuge“ einen Pfad hinterlegen.
        </p>
      )}
      <div>
        <Button
          size="sm"
          variant="destructive"
          disabled={running || !path.trim() || Boolean(missingTool)}
          onClick={() => setConfirming(true)}
        >
          {running ? "Wiederherstellung läuft…" : "Wiederherstellen…"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="whitespace-pre-wrap break-words text-xs text-destructive">
          {error}
        </p>
      )}
      {jobId && <BackupJobLog jobId={jobId} />}
      <RestoreConfirmDialog
        open={confirming}
        connectionName={connection.name}
        endpoint={endpoint}
        database={database}
        source={path}
        effects={restoreEffects(kind, options)}
        phrase={restoreConfirmationPhrase(database, connection.name)}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void start()}
      />
    </div>
  );
}

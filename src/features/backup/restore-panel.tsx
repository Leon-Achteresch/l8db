import { useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { HistoryIcon } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  defaultBackupOptions,
  restoreBlockReason,
  restoreConfirmationPhrase,
  restoreEffects,
  restoreToolFor,
} from "@/lib/backup";
import { backupScope, runBackupJob, useBackupJobs } from "@/lib/backup-runner";
import { connectionSummary, providerFor } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import type { BackupOptions, BackupToolInfo } from "@/lib/db";
import { useCapabilities } from "@/lib/providers";
import { isConnectionQuery } from "@/lib/query-client";
import { isTaskActive, useTasksStore } from "@/lib/tasks";
import { BackupAdvancedOptions } from "./backup-advanced-options";
import { BackupField } from "./backup-field";
import { BackupJobLog } from "./backup-job-log";
import { BackupOptionsFields } from "./backup-options-fields";
import { BackupSection } from "./backup-section";
import { RestoreConfirmDialog } from "./restore-confirm-dialog";

interface RestorePanelProps {
  connection: SavedConnection;
  database: string | null;
  tools: BackupToolInfo[] | undefined;
  initialPath: string;
  actions: HTMLElement | null;
  onOpenTools: () => void;
}

const PATH_HINTS: Partial<Record<string, string>> = {
  postgres:
    "Format wird erkannt: SQL-Skripte laufen über psql, Custom/Tar/Verzeichnis über pg_restore. Löschen, Eigentümer- und Rechteoptionen gelten nur für pg_restore.",
  mysql: "SQL-Datei wird über den mysql-Client in die gewählte Datenbank eingespielt.",
};

export function RestorePanel({
  connection,
  database,
  tools,
  initialPath,
  actions,
  onOpenTools,
}: RestorePanelProps) {
  const kind = connection.kind;
  const caps = useCapabilities(kind);
  const queryClient = useQueryClient();
  const [options, setOptions] = useState<BackupOptions>(() =>
    defaultBackupOptions(kind, "restore"),
  );
  const [path, setPath] = useState(initialPath);
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
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <p
          role="alert"
          className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          {blocked}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl px-6 pb-6">
      <BackupSection title="Ziel">
        <BackupField label="Verbindung">
          <ProviderLogo providerId={providerFor(connection).id} kind={kind} className="size-4" />
          <span className="text-sm font-medium">{connection.name}</span>
          <span className="text-muted-foreground">/</span>
          <span className="font-mono text-sm">{database ?? "Standard-Datenbank"}</span>
        </BackupField>
        {endpoint && (
          <BackupField label="Server">
            <span className="font-mono text-xs text-muted-foreground">{endpoint}</span>
          </BackupField>
        )}
      </BackupSection>

      <BackupSection title="Sicherung">
        <BackupField label={serverSide ? "Serverpfad" : "Datei"} htmlFor="restore-path">
          <Input
            id="restore-path"
            value={path}
            disabled={running}
            placeholder={serverSide ? "/var/opt/mssql/backup/app.bak" : "Datei wählen"}
            title={PATH_HINTS[kind]}
            className="h-8 min-w-0 flex-1 font-mono text-xs md:text-xs"
            onChange={(event) => setPath(event.target.value)}
          />
          {!serverSide && (
            <Button variant="outline" size="sm" disabled={running} onClick={() => void pick(false)}>
              Datei…
            </Button>
          )}
          {kind === "postgres" && (
            <Button variant="outline" size="sm" disabled={running} onClick={() => void pick(true)}>
              Verzeichnis…
            </Button>
          )}
        </BackupField>
        <BackupOptionsFields
          kind={kind}
          mode="restore"
          options={options}
          disabled={running}
          onChange={(patch) => setOptions((current) => ({ ...current, ...patch }))}
        />
      </BackupSection>

      <BackupAdvancedOptions
        kind={kind}
        mode="restore"
        options={options}
        disabled={running}
        onChange={(patch) => setOptions((current) => ({ ...current, ...patch }))}
      />

      <div className="grid gap-3">
        {missingTool && (
          <p role="alert" className="flex items-center gap-2 text-xs text-destructive">
            {missingTool} wurde nicht gefunden.
            <Button variant="link" size="xs" className="h-auto px-0" onClick={onOpenTools}>
              Pfad hinterlegen
            </Button>
          </p>
        )}
        {error && (
          <p role="alert" className="whitespace-pre-wrap break-words text-xs text-destructive">
            {error}
          </p>
        )}
        {jobId && <BackupJobLog jobId={jobId} />}
      </div>
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
      {actions &&
        createPortal(
          <Button
            size="sm"
            variant="destructive"
            disabled={running || !path.trim() || Boolean(missingTool)}
            onClick={() => setConfirming(true)}
          >
            {running ? <Spinner className="size-3.5" /> : <HistoryIcon />}
            {running ? "Wiederherstellung läuft…" : "Wiederherstellen…"}
          </Button>,
          actions,
        )}
    </div>
  );
}

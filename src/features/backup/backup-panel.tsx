import { open, save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BACKUP_FORMATS,
  backupFormat,
  backupToolFor,
  defaultBackupFileName,
  defaultBackupOptions,
} from "@/lib/backup";
import { backupScope, runBackupJob, useBackupJobs } from "@/lib/backup-runner";
import type { SavedConnection } from "@/lib/connections";
import type { BackupOptions, BackupToolInfo } from "@/lib/db";
import { isTaskActive, useTasksStore } from "@/lib/tasks";
import { BackupJobLog } from "./backup-job-log";
import { BackupOptionsFields } from "./backup-options-fields";

interface BackupPanelProps {
  connection: SavedConnection;
  database: string | null;
  tools: BackupToolInfo[] | undefined;
}

export function BackupPanel({ connection, database, tools }: BackupPanelProps) {
  const kind = connection.kind;
  const [options, setOptions] = useState<BackupOptions>(() => defaultBackupOptions(kind, "backup"));
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const jobId = useBackupJobs(
    (state) => state.lastJob[backupScope("backup", connection.id, database)],
  );
  const running = useTasksStore((state) =>
    state.tasks.some((task) => task.id === jobId && isTaskActive(task)),
  );
  const format = backupFormat(kind, options.format);
  const formats = BACKUP_FORMATS[kind] ?? [];
  const suggested = defaultBackupFileName(kind, options, database || connection.name);
  const required = backupToolFor(kind, options.format);
  const missingTool =
    required && tools?.some((tool) => tool.name === required && !tool.path) ? required : null;
  const scope = backupScope("backup", connection.id, database);

  const pickTarget = async () => {
    setError(null);
    try {
      if (format?.directory) {
        const parent = await open({ directory: true, multiple: false });
        if (typeof parent === "string") setPath(`${parent.replace(/[\\/]$/, "")}/${suggested}`);
        return;
      }
      const picked = await save({
        defaultPath: suggested,
        filters: format?.extension
          ? [{ name: format.label, extensions: [format.extension.replace(/\.gz$/, "")] }]
          : undefined,
      });
      if (picked) setPath(picked);
    } catch (failure) {
      setError(String(failure));
    }
  };

  const start = async () => {
    setError(null);
    const previous = useBackupJobs.getState().lastJob[scope];
    try {
      await runBackupJob({
        mode: "backup",
        connection,
        database,
        path: format?.noFile ? "" : path,
        options,
      });
    } catch (failure) {
      if (useBackupJobs.getState().lastJob[scope] === previous) setError(String(failure));
    }
  };

  const ready = format?.noFile || path.trim().length > 0;

  return (
    <div className="grid max-w-4xl gap-5">
      {formats.length > 1 && (
        <div className="grid max-w-sm gap-1">
          <Label htmlFor="backup-format" className="text-xs">
            Format
          </Label>
          <Select
            value={options.format}
            disabled={running}
            onValueChange={(value) => {
              setOptions((current) => ({ ...current, format: value }));
              setPath("");
            }}
          >
            <SelectTrigger id="backup-format" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {formats.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {formats.length === 1 && <p className="text-xs text-muted-foreground">{format?.label}</p>}

      {!format?.noFile && (
        <div className="grid gap-1">
          <Label htmlFor="backup-path" className="text-xs">
            {format?.serverSide
              ? "Zieldatei auf dem Server"
              : format?.directory
                ? "Zielverzeichnis (wird angelegt)"
                : "Zieldatei"}
          </Label>
          <div className="flex gap-2">
            <Input
              id="backup-path"
              value={path}
              disabled={running}
              placeholder={format?.serverSide ? `/var/opt/mssql/backup/${suggested}` : suggested}
              className="h-8 font-mono text-xs"
              onChange={(event) => setPath(event.target.value)}
            />
            {!format?.serverSide && (
              <Button
                variant="outline"
                size="sm"
                disabled={running}
                onClick={() => void pickTarget()}
              >
                {format?.directory ? "Ordner wählen…" : "Speichern unter…"}
              </Button>
            )}
          </div>
          {format?.serverSide && (
            <span className="text-[11px] text-muted-foreground">
              Der Pfad wird vom SQL-Server-Dienst geschrieben und muss auf dem Server existieren.
            </span>
          )}
        </div>
      )}

      <BackupOptionsFields
        kind={kind}
        mode="backup"
        options={options}
        disabled={running}
        onChange={(patch) => setOptions((current) => ({ ...current, ...patch }))}
      />

      {missingTool && (
        <p role="alert" className="text-xs text-destructive">
          {missingTool} wurde nicht gefunden. Im Reiter „Werkzeuge“ einen Pfad hinterlegen.
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={running || !ready || Boolean(missingTool)}
          onClick={() => void start()}
        >
          {running ? "Sicherung läuft…" : format?.noFile ? "BGSAVE auslösen" : "Sicherung starten"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Läuft im Hintergrund und erscheint unter Aufgaben.
        </span>
      </div>
      {error && (
        <p role="alert" className="whitespace-pre-wrap break-words text-xs text-destructive">
          {error}
        </p>
      )}
      {jobId && <BackupJobLog jobId={jobId} />}
    </div>
  );
}

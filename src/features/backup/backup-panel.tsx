import { open } from "@tauri-apps/plugin-dialog";
import { ArchiveIcon, FileIcon, FolderIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { BACKUP_FORMATS, backupFormat, backupToolFor, defaultBackupOptions } from "@/lib/backup";
import { backupScope, runBackupJob, useBackupJobs } from "@/lib/backup-runner";
import { copyWithToast } from "@/lib/clipboard";
import { providerFor } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import type { BackupOptions, BackupToolInfo } from "@/lib/db";
import { useConnectionEnvironment } from "@/lib/environments";
import { isTaskActive, useTasksStore } from "@/lib/tasks";
import { BackupAdvancedOptions } from "./backup-advanced-options";
import { BackupField } from "./backup-field";
import { BackupJobLog } from "./backup-job-log";
import { BackupOptionsFields } from "./backup-options-fields";
import { BackupSection } from "./backup-section";
import { BackupSegments } from "./backup-segments";

interface BackupPanelProps {
  connection: SavedConnection;
  database: string | null;
  tools: BackupToolInfo[] | undefined;
  serverVersion: string | null | undefined;
  actions: HTMLElement | null;
  onOpenTools: () => void;
}

const FOLDER_KEY = "l8db.backup-folder";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function renderPattern(pattern: string, name: string, now: Date) {
  const db = name.normalize("NFKD").replace(/[^\w.-]+/g, "-") || "backup";
  return pattern
    .replaceAll("{db}", db)
    .replaceAll("{datum}", `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
    .replaceAll("{zeit}", `${pad(now.getHours())}${pad(now.getMinutes())}`);
}

export function BackupPanel({
  connection,
  database,
  tools,
  serverVersion,
  actions,
  onOpenTools,
}: BackupPanelProps) {
  const kind = connection.kind;
  const environment = useConnectionEnvironment(connection);
  const [options, setOptions] = useState<BackupOptions>(() => defaultBackupOptions(kind, "backup"));
  const [folder, setFolder] = useState(() => localStorage.getItem(FOLDER_KEY) ?? "");
  const [pattern, setPattern] = useState<string | null>(null);
  const [serverPath, setServerPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scope = backupScope("backup", connection.id, database);
  const jobId = useBackupJobs((state) => state.lastJob[scope]);
  const command = useBackupJobs((state) => (jobId ? state.outcomes[jobId]?.command : undefined));
  const running = useTasksStore((state) =>
    state.tasks.some((task) => task.id === jobId && isTaskActive(task)),
  );
  const format = backupFormat(kind, options.format);
  const formats = BACKUP_FORMATS[kind] ?? [];
  const required = backupToolFor(kind, options.format);
  const missingTool =
    required && tools?.some((tool) => tool.name === required && !tool.path) ? required : null;
  const label = database || connection.name;
  const defaultPattern =
    format?.value === "globals" ? "{db}-globals-{datum}-{zeit}" : "{db}-{datum}-{zeit}";
  const activePattern = pattern ?? defaultPattern;
  const extension = format?.extension
    ? `.${format.extension}${kind === "mongodb" && options.gzip ? ".gz" : ""}`
    : "";
  const rendered = renderPattern(activePattern, label, new Date());
  const fileName = rendered.endsWith(extension) ? rendered : `${rendered}${extension}`;
  const localPath = folder.trim() ? `${folder.trim().replace(/[\\/]$/, "")}/${fileName}` : "";
  const path = format?.noFile ? "" : format?.serverSide ? serverPath.trim() : localPath;
  const ready = format?.noFile || (path.length > 0 && rendered.trim().length > 0);

  const pickFolder = async () => {
    setError(null);
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        defaultPath: folder || undefined,
      });
      if (typeof picked === "string") {
        setFolder(picked);
        localStorage.setItem(FOLDER_KEY, picked);
      }
    } catch (failure) {
      setError(String(failure));
    }
  };

  const start = async () => {
    setError(null);
    const previous = useBackupJobs.getState().lastJob[scope];
    try {
      await runBackupJob({ mode: "backup", connection, database, path, options });
    } catch (failure) {
      if (useBackupJobs.getState().lastJob[scope] === previous) setError(String(failure));
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-3xl px-6 pb-6">
      <BackupSection title="Quelle">
        <BackupField label="Verbindung">
          <ProviderLogo providerId={providerFor(connection).id} kind={kind} className="size-4" />
          <span className="text-sm font-medium">{connection.name}</span>
          <span className="text-muted-foreground">/</span>
          <span className="font-mono text-sm">{database ?? "Standard-Datenbank"}</span>
          {environment && (
            <span
              className="rounded-md px-1.5 py-0.5 text-[11px] font-medium"
              style={{ color: environment.color, backgroundColor: `${environment.color}1f` }}
            >
              {environment.label}
            </span>
          )}
          {serverVersion && (
            <span className="text-xs text-muted-foreground tabular-nums">
              Server {serverVersion}
            </span>
          )}
        </BackupField>
      </BackupSection>

      <BackupSection title="Inhalt">
        <BackupField label="Format">
          {formats.length > 1 ? (
            <BackupSegments
              label="Format"
              value={options.format}
              disabled={running}
              options={formats.map((entry) => ({
                value: entry.value,
                label: entry.label.split(" (")[0],
              }))}
              onChange={(value) => {
                setOptions((current) => ({ ...current, format: value }));
                setPattern(null);
              }}
            />
          ) : (
            <span className="text-sm">{format?.label}</span>
          )}
          {formats.length > 1 && format?.label.includes(" (") && (
            <span className="text-xs text-muted-foreground">
              {format.label.slice(format.label.indexOf(" (") + 2, -1)}
            </span>
          )}
        </BackupField>
        <BackupOptionsFields
          kind={kind}
          mode="backup"
          options={options}
          disabled={running}
          onChange={(patch) => setOptions((current) => ({ ...current, ...patch }))}
        />
      </BackupSection>

      {!format?.noFile && (
        <BackupSection title="Ziel">
          {format?.serverSide ? (
            <BackupField label="Serverpfad" htmlFor="backup-server-path">
              <Input
                id="backup-server-path"
                value={serverPath}
                disabled={running}
                placeholder={`/var/opt/mssql/backup/${fileName}`}
                title="Der Pfad wird vom SQL-Server-Dienst geschrieben und muss auf dem Server existieren."
                className="h-8 flex-1 font-mono text-xs md:text-xs"
                onChange={(event) => setServerPath(event.target.value)}
              />
            </BackupField>
          ) : (
            <>
              <BackupField label="Ordner" htmlFor="backup-folder">
                <div className="relative min-w-0 flex-1">
                  <FolderIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="backup-folder"
                    value={folder}
                    disabled={running}
                    placeholder="Ordner wählen"
                    className="h-8 pl-8 font-mono text-xs md:text-xs"
                    onChange={(event) => setFolder(event.target.value)}
                    onBlur={() => {
                      if (folder.trim()) localStorage.setItem(FOLDER_KEY, folder.trim());
                    }}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={running}
                  onClick={() => void pickFolder()}
                >
                  Wählen…
                </Button>
              </BackupField>
              <BackupField
                label={format?.directory ? "Verzeichnisname" : "Dateiname"}
                htmlFor="backup-pattern"
              >
                <div className="relative min-w-0 flex-1">
                  <Input
                    id="backup-pattern"
                    value={activePattern}
                    disabled={running}
                    className="h-8 pr-16 font-mono text-xs md:text-xs"
                    onChange={(event) => setPattern(event.target.value)}
                  />
                  {extension && (
                    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                      {extension}
                    </span>
                  )}
                </div>
              </BackupField>
              <BackupField label="">
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <FileIcon className="size-3.5 shrink-0" />
                  <span className="truncate font-mono text-foreground/80">{fileName}</span>
                  <span>
                    · {"{db}"}, {"{datum}"}, {"{zeit}"}
                  </span>
                </span>
              </BackupField>
            </>
          )}
        </BackupSection>
      )}

      <BackupAdvancedOptions
        kind={kind}
        mode="backup"
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

      {actions &&
        createPortal(
          <>
            {command && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void copyWithToast(command, "Befehl")}
              >
                <TerminalIcon />
                Befehl kopieren
              </Button>
            )}
            <Button
              size="sm"
              disabled={running || !ready || Boolean(missingTool)}
              onClick={() => void start()}
            >
              {running ? <Spinner className="size-3.5" /> : <ArchiveIcon />}
              {running
                ? "Sicherung läuft…"
                : format?.noFile
                  ? "BGSAVE auslösen"
                  : "Sicherung starten"}
            </Button>
          </>,
          actions,
        )}
    </div>
  );
}

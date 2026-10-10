import {
  ArchiveRestoreIcon,
  CloudDownloadIcon,
  CloudUploadIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { SyncAutoRow } from "@/features/settings/sync-auto-row";
import { SyncBackupsDialog } from "@/features/settings/sync-backups-dialog";
import { SyncConflictDialog } from "@/features/settings/sync-conflict-dialog";
import { SyncPreviewDialog } from "@/features/settings/sync-preview-dialog";
import { SyncProviderForm } from "@/features/settings/sync-provider-form";
import { SyncSecurityRow } from "@/features/settings/sync-security-row";
import { errorMessage, performSync } from "@/lib/sync/controller";
import type { SyncDecider, SyncDecision, SyncMode } from "@/lib/sync/engine";
import type { ConflictStrategy, SyncConflict } from "@/lib/sync/merge";
import { syncTarget, useSyncStore } from "@/lib/sync/store";

type Preview = Extract<SyncDecision, { kind: "preview" }>;

const STATUS_LABELS: Record<string, string> = {
  idle: "Bereit",
  running: "Synchronisiert…",
  ok: "Erfolgreich",
  skipped: "Unverändert",
  error: "Fehler",
  conflict: "Konflikt",
};

export function SyncPanel() {
  const state = useSyncStore();
  const [running, setRunning] = useState(false);
  const [conflicts, setConflicts] = useState<SyncConflict[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmUpload, setConfirmUpload] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const resolveConflicts = useRef<((strategy: ConflictStrategy | null) => void) | null>(null);
  const resolvePreview = useRef<((accepted: boolean) => void) | null>(null);
  const controller = useRef<AbortController | null>(null);
  const ready = syncTarget(state) !== null;
  const blocked =
    state.provider === "webdav" &&
    /^http:\/\//i.test(state.webdavUrl.trim()) &&
    !state.webdavAllowInsecure;
  const decider: SyncDecider = {
    conflicts: (list) =>
      new Promise((resolve) => {
        resolveConflicts.current = resolve;
        setConflicts(list);
      }),
    preview: (decision) =>
      new Promise((resolve) => {
        resolvePreview.current = resolve;
        setPreview(decision);
      }),
  };
  const run = async (mode: SyncMode) => {
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    try {
      const outcome = await performSync(mode, decider, abort.signal);
      if (outcome.status === "ok" || outcome.status === "skipped")
        toast.success(useSyncStore.getState().lastMessage ?? "Synchronisiert");
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError"))
        toast.error(errorMessage(error));
    } finally {
      controller.current = null;
      setRunning(false);
    }
  };
  const lastSync = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString("de-DE") : "nie";
  return (
    <>
      <SettingsRow settingId="sync" featureId="settings.general.sync" stacked>
        <div className="space-y-3">
          <SyncProviderForm />
          {state.provider && (
            <>
              <p className="text-xs text-muted-foreground">
                Übertragen werden Verbindungen ohne Passwörter, Servergruppen, gespeicherte
                Abfragen, Snippets sowie Einstellungen, Tastenkürzel, Layouts, Favoriten und
                Tabellenansichten. Sicherheitsrelevante Einstellungen, temporäre Verbindungen und
                Befehls-Tunnel bleiben lokal.
              </p>
              <div className="flex items-center gap-2 text-xs">
                <Switch
                  checked={state.includeHistory}
                  onCheckedChange={(checked) => state.configure({ includeHistory: checked })}
                  aria-label="Query-Verlauf mitsynchronisieren"
                />
                <span>Query-Verlauf mitsynchronisieren</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!ready || blocked || running}
                  onClick={() => void run("sync")}
                >
                  <RefreshCwIcon className={running ? "size-3.5 animate-spin" : "size-3.5"} />
                  Synchronisieren
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!ready || blocked || running}
                  onClick={() => setConfirmUpload(true)}
                >
                  <CloudUploadIcon className="size-3.5" />
                  Hochladen
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!ready || blocked || running}
                  onClick={() => void run("download")}
                >
                  <CloudDownloadIcon className="size-3.5" />
                  Herunterladen
                </Button>
                {running && (
                  <Button size="sm" variant="ghost" onClick={() => controller.current?.abort()}>
                    Abbrechen
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setBackupsOpen(true)}>
                  <ArchiveRestoreIcon className="size-3.5" />
                  Sicherungen
                </Button>
              </div>
              <div className="space-y-1 text-xs" aria-live="polite">
                <div className="text-muted-foreground">
                  Letzte Synchronisierung: {lastSync} · Status:{" "}
                  {STATUS_LABELS[state.lastStatus] ?? state.lastStatus}
                  {state.lastMessage ? ` · ${state.lastMessage}` : ""}
                </div>
                {state.lastError && <div className="text-destructive">{state.lastError}</div>}
              </div>
            </>
          )}
        </div>
      </SettingsRow>
      {state.provider && <SyncSecurityRow />}
      {state.provider && <SyncAutoRow />}
      <SyncConflictDialog
        conflicts={conflicts}
        onResolve={(strategy) => {
          setConflicts(null);
          resolveConflicts.current?.(strategy);
          resolveConflicts.current = null;
        }}
      />
      <SyncPreviewDialog
        decision={preview}
        onDecide={(accepted) => {
          setPreview(null);
          resolvePreview.current?.(accepted);
          resolvePreview.current = null;
        }}
      />
      <SyncBackupsDialog open={backupsOpen} onOpenChange={setBackupsOpen} />
      <Dialog open={confirmUpload} onOpenChange={setConfirmUpload}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remote-Daten ersetzen</DialogTitle>
            <DialogDescription>
              Der aktuelle Stand dieses Rechners überschreibt die Sync-Datei auf dem Server.
              Änderungen anderer Rechner, die noch nicht synchronisiert wurden, gehen dort verloren.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmUpload(false)}>
              Abbrechen
            </Button>
            <Button
              onClick={() => {
                setConfirmUpload(false);
                void run("upload");
              }}
            >
              Hochladen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

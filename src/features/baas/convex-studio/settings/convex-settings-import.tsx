import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type ConvexImportMode,
  convexStudioSettingsImportCancel,
  convexStudioSettingsImportConfirm,
  convexStudioSettingsImportStart,
  convexStudioSettingsImportStatus,
} from "@/lib/db/convex-studio-settings";
import type { ConvexStudioDeployment } from "../convex-studio-sections";
import { convexSettingsKey } from "./use-convex-settings-info";

const MODES: { value: ConvexImportMode; label: string }[] = [
  { value: "append", label: "Anhängen" },
  { value: "replace", label: "Ersetzen" },
  { value: "requireEmpty", label: "Nur in leere Tabellen" },
];

export function ConvexSettingsImport({ deployment }: { deployment: ConvexStudioDeployment }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<ConvexImportMode>("append");
  const [table, setTable] = useState("");
  const [importId, setImportId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = useQuery({
    queryKey: convexSettingsKey(deployment, `import:${importId}`),
    queryFn: () => convexStudioSettingsImportStatus(deployment, importId ?? ""),
    enabled: importId !== null,
    refetchInterval: (query) => {
      const state = query.state.data?.state.state;
      return state === "uploaded" || state === "in_progress" ? 1000 : false;
    },
  });
  const state = status.data?.state;

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    act(async () => {
      const id = await convexStudioSettingsImportStart(deployment, mode, table.trim() || null);
      if (id) setImportId(id);
    });

  const confirm = () =>
    act(async () => {
      if (!importId) return;
      await convexStudioSettingsImportConfirm(deployment, importId);
      await status.refetch();
    });

  const cancel = () =>
    act(async () => {
      if (!importId) return;
      await convexStudioSettingsImportCancel(deployment, importId);
      await status.refetch();
    });

  return (
    <section className="rounded-2xl border bg-card p-5">
      <h3 className="text-sm font-semibold">Import</h3>
      <p className="mt-1 text-[11px] text-muted-foreground">
        ZIP-Snapshot (alle Tabellen) oder eine .jsonl-, .json- bzw. .csv-Datei in eine Zieltabelle.
        Vor dem Schreiben zeigt Convex eine Zusammenfassung zur Bestätigung.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select value={mode} onValueChange={(value) => setMode(value as ConvexImportMode)}>
          <SelectTrigger size="sm" className="w-48" aria-label="Importmodus">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-8 min-w-56 flex-1 font-mono text-xs"
          value={table}
          onChange={(event) => setTable(event.target.value)}
          placeholder="Zieltabelle (nicht bei ZIP)"
          aria-label="Zieltabelle"
          spellCheck={false}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => void start()}
          disabled={
            busy ||
            state?.state === "uploaded" ||
            state?.state === "waiting_for_confirmation" ||
            state?.state === "in_progress"
          }
        >
          <Upload className="size-3.5" /> {busy && !importId ? "Lädt hoch…" : "Datei wählen"}
        </Button>
      </div>
      {importId && (
        <div className="mt-4 space-y-3 rounded-lg border bg-background/50 p-3 text-xs">
          {status.isError ? (
            <p role="alert" className="text-destructive">
              {String(status.error)}
            </p>
          ) : !state ? (
            <p className="text-muted-foreground">Status wird geladen…</p>
          ) : state.state === "waiting_for_confirmation" ? (
            <>
              <pre className="overflow-x-auto font-mono text-[11px] whitespace-pre-wrap">
                {state.message_to_confirm}
              </pre>
              {status.data?.mode === "replace" && (
                <p className="text-destructive">
                  Ersetzen löscht vorhandene Dokumente in den betroffenen Tabellen.
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={status.data?.mode === "replace" ? "destructive" : "default"}
                  onClick={() => void confirm()}
                  disabled={busy}
                >
                  Import ausführen
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void cancel()} disabled={busy}>
                  Abbrechen
                </Button>
              </div>
            </>
          ) : state.state === "completed" ? (
            <>
              <p className="font-medium">Import abgeschlossen.</p>
              <ul className="text-muted-foreground">
                {status.data?.checkpoints?.map((checkpoint) => (
                  <li key={checkpoint.display_table_name}>
                    {checkpoint.display_table_name}: {checkpoint.num_rows_written} Dokumente
                    geschrieben
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setImportId(null);
                  void queryClient.invalidateQueries({
                    queryKey: ["convex", deployment.profileId],
                  });
                }}
              >
                Schließen
              </Button>
            </>
          ) : state.state === "failed" ? (
            <>
              <p role="alert" className="text-destructive">
                {state.error_message ?? "Import fehlgeschlagen."}
              </p>
              <Button size="sm" variant="ghost" onClick={() => setImportId(null)}>
                Schließen
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground">
              {state.state === "uploaded" ? "Datei wird geprüft…" : "Import läuft…"}
              {state.progress_message ? ` ${state.progress_message}` : ""}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

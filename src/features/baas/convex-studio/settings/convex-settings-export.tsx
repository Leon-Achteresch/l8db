import { useQuery } from "@tanstack/react-query";
import { Download, PackageOpen, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatBytes } from "@/lib/backup";
import {
  convexStudioSettingsExportDownload,
  convexStudioSettingsExportRequest,
  convexStudioSettingsExportStatus,
} from "@/lib/db/convex-studio-settings";
import type { ConvexStudioDeployment } from "../convex-studio-sections";
import { convexSettingsKey } from "./use-convex-settings-info";

const STATE_LABELS: Record<string, string> = {
  requested: "Angefordert",
  in_progress: "Wird erstellt",
  completed: "Bereit",
  failed: "Fehlgeschlagen",
};

const nsDate = (value: string | null | undefined) =>
  value ? new Date(Number(BigInt(value) / 1_000_000n)).toLocaleString("de-DE") : "–";

export function ConvexSettingsExport({ deployment }: { deployment: ConvexStudioDeployment }) {
  const [includeStorage, setIncludeStorage] = useState(true);
  const [busy, setBusy] = useState(false);
  const status = useQuery({
    queryKey: convexSettingsKey(deployment, "export"),
    queryFn: () => convexStudioSettingsExportStatus(deployment),
    refetchInterval: (query) =>
      query.state.data?.state === "requested" || query.state.data?.state === "in_progress"
        ? 2000
        : false,
  });
  const latest = status.data;
  const running = latest?.state === "requested" || latest?.state === "in_progress";

  async function request() {
    setBusy(true);
    try {
      await convexStudioSettingsExportRequest(deployment, includeStorage);
      toast.success("Snapshot-Export angefordert.");
      await status.refetch();
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    setBusy(true);
    try {
      const path = await convexStudioSettingsExportDownload(deployment);
      if (path) toast.success(`Snapshot gespeichert unter ${path}`);
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Snapshot-Export</h3>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Exportstatus aktualisieren"
          onClick={() => void status.refetch()}
          disabled={status.isFetching}
        >
          <RefreshCw className={`size-3.5 ${status.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Erstellt ein ZIP mit allen Tabellen als JSONL, optional mit gespeicherten Dateien.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label htmlFor="convex-export-storage" className="flex items-center gap-2 text-xs">
          <Checkbox
            id="convex-export-storage"
            checked={includeStorage}
            onCheckedChange={(checked) => setIncludeStorage(checked === true)}
          />
          Dateien einschließen
        </label>
        <Button size="sm" onClick={() => void request()} disabled={busy || running}>
          <PackageOpen className="size-3.5" /> Export anfordern
        </Button>
      </div>
      {status.isError ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {String(status.error)}
        </p>
      ) : latest ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/50 p-3 text-xs">
          <div className="space-y-0.5">
            <p className="font-medium">
              Letzter Export: {STATE_LABELS[latest.state] ?? latest.state}
              {running && " …"}
            </p>
            <p className="text-muted-foreground">
              Gestartet {nsDate(latest.start_ts)}
              {latest.complete_ts ? ` · fertig ${nsDate(latest.complete_ts)}` : ""}
              {latest.size ? ` · ${formatBytes(Number(latest.size))}` : ""}
              {latest.format?.include_storage ? " · mit Dateien" : ""}
              {latest.expiration_ts ? ` · läuft ab ${nsDate(latest.expiration_ts)}` : ""}
            </p>
          </div>
          {latest.state === "completed" && (
            <Button variant="outline" size="sm" onClick={() => void download()} disabled={busy}>
              <Download className="size-3.5" /> Herunterladen
            </Button>
          )}
        </div>
      ) : (
        !status.isPending && (
          <p className="mt-3 text-xs text-muted-foreground">Noch kein Export vorhanden.</p>
        )
      )}
    </section>
  );
}

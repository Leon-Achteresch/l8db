import { getVersion } from "@tauri-apps/api/app";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConnectionsStore } from "@/lib/connections";
import { listProviders, type ProviderInfo } from "@/lib/db";
import {
  buildDiagnosticsPackage,
  collectSystemInfo,
  DIAGNOSTICS_SECTIONS,
  type DiagnosticsInput,
  type DiagnosticsSectionId,
  recentDiagnosticErrors,
  serializeDiagnostics,
} from "@/lib/diagnostics";
import { useProvidersStore } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ALL_SECTIONS = DIAGNOSTICS_SECTIONS.map((section) => section.id);

export function DiagnosticsDialog({ open, onOpenChange }: Props) {
  const [enabled, setEnabled] = useState<Set<DiagnosticsSectionId>>(() => new Set(ALL_SECTIONS));
  const [input, setInput] = useState<DiagnosticsInput | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const collect = useCallback(async () => {
    setLoading(true);
    const warnings: string[] = [];
    let version = "unbekannt";
    try {
      version = await getVersion();
    } catch (error) {
      warnings.push(`App-Version nicht lesbar: ${error instanceof Error ? error.message : error}`);
    }
    let providers: ProviderInfo[] = useProvidersStore.getState().providers;
    if (providers.length === 0) {
      try {
        providers = await listProviders();
      } catch (error) {
        warnings.push(
          `Treiber- und Anbieterstatus nicht lesbar: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    let connections = useConnectionsStore.getState().connections;
    if (!Array.isArray(connections)) {
      warnings.push("Verbindungsprofile nicht lesbar.");
      connections = [];
    }
    setInput({
      app: { name: "l8db", version },
      system: collectSystemInfo(),
      providers,
      connections,
      settings: useSettingsStore.getState(),
      errors: recentDiagnosticErrors(),
      warnings,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    void collect();
  }, [open, collect]);

  const preview = useMemo(() => {
    if (!input) return "";
    return serializeDiagnostics(
      buildDiagnosticsPackage(
        input,
        ALL_SECTIONS.filter((section) => enabled.has(section)),
      ),
    );
  }, [input, enabled]);

  function toggle(section: DiagnosticsSectionId) {
    setEnabled((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  async function savePackage() {
    if (!preview) return;
    setBusy(true);
    try {
      const path = await save({
        defaultPath: "l8db-diagnose.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await writeTextFile(path, preview);
      toast.success("Diagnosepaket lokal gespeichert");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Diagnosepaket erstellen</DialogTitle>
          <DialogDescription>
            Das Paket wird nur lokal gespeichert. Verbindungs-URLs, Passwörter, SQL-Verlauf und
            Ergebnisdaten sind nicht enthalten; Hosts werden maskiert.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[15rem_1fr]">
          <div className="flex flex-col gap-1">
            {DIAGNOSTICS_SECTIONS.map((section) => (
              <label
                key={section.id}
                className="flex items-start gap-2 rounded-md p-1 text-sm hover:bg-muted/40"
              >
                <Checkbox
                  checked={enabled.has(section.id)}
                  onCheckedChange={() => toggle(section.id)}
                />
                <span className="min-w-0">
                  <span className="block leading-tight">{section.label}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {section.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <pre className="max-h-80 min-h-40 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] whitespace-pre-wrap">
            {loading ? "Daten werden gesammelt…" : preview}
          </pre>
        </div>

        {input && input.warnings.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            {input.warnings.map((warning) => (
              <p key={warning} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {warning}
              </p>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button variant="outline" onClick={() => void collect()} disabled={loading}>
            Neu sammeln
          </Button>
          <Button onClick={savePackage} disabled={busy || loading || enabled.size === 0}>
            Als JSON speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, RefreshCw, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  convexDeleteEnvironmentVariable,
  convexEnvironmentVariables,
  convexSetEnvironmentVariable,
} from "@/lib/db";
import { convexStudioSettingsEnvExport } from "@/lib/db/convex-studio-settings";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { ConvexStudioSectionProps } from "../convex-studio-sections";
import { ConvexEnvironmentImportDialog } from "./convex-environment-import-dialog";
import { ConvexEnvironmentRow } from "./convex-environment-row";

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function ConvexEnvironmentSection({ deployment }: ConvexStudioSectionProps) {
  const queryClient = useQueryClient();
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.convex.studio.environment");
  const { profileId, projectId, deploymentName } = deployment;
  const queryKey = ["convex", profileId, "environment", projectId, deploymentName];
  const variables = useQuery({
    queryKey,
    queryFn: () => convexEnvironmentVariables(profileId, projectId, deploymentName),
  });
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const shown = (variables.data ?? []).filter((item) =>
    item.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const refresh = () => void queryClient.invalidateQueries({ queryKey });

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      return true;
    } catch (reason) {
      toast.error(String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const variable = name.trim();
    if (!NAME_PATTERN.test(variable)) {
      toast.error("Bitte einen gültigen Variablennamen eingeben.");
      return;
    }
    const replacing = variables.data?.includes(variable);
    const done = await run(
      () => convexSetEnvironmentVariable(profileId, projectId, deploymentName, variable, value),
      replacing ? `${variable} überschrieben.` : `${variable} angelegt.`,
    );
    if (!done) return;
    setName("");
    setValue("");
    refresh();
  }

  async function remove(target: string) {
    const done = await run(
      () => convexDeleteEnvironmentVariable(profileId, projectId, deploymentName, target),
      `${target} gelöscht.`,
    );
    setDeleteTarget(null);
    if (done) refresh();
  }

  async function exportFile() {
    setExporting(false);
    setBusy(true);
    try {
      const path = await convexStudioSettingsEnvExport(deployment);
      if (path) toast.success(`Gespeichert unter ${path}`);
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div ref={feature.ref} className="flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Umgebungsvariablen</h2>
            {feature.isNew && <NewBadge />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Werte bleiben verborgen, bis du sie einzeln anzeigst. Änderungen wirken sofort auf alle
            Funktionen.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setImporting(true)} disabled={busy}>
            <Upload className="size-3.5" /> .env importieren
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExporting(true)}
            disabled={busy || !variables.data?.length}
          >
            <Download className="size-3.5" /> Als .env exportieren
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Variablen aktualisieren"
            onClick={refresh}
            disabled={variables.isFetching}
          >
            <RefreshCw className={`size-3.5 ${variables.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <section className="rounded-2xl border bg-card p-5">
        <h3 className="text-sm font-semibold">Variable hinzufügen</h3>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Input
            className="h-8 min-w-40 flex-1 font-mono text-xs"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Variablenname"
            placeholder="NAME"
            spellCheck={false}
            autoComplete="off"
            required
          />
          <Input
            className="h-8 min-w-40 flex-[2] font-mono text-xs"
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label="Variablenwert"
            placeholder="Wert"
            autoComplete="off"
          />
          <Button size="sm" type="submit" disabled={busy || !name.trim()}>
            <Plus className="size-3.5" /> Speichern
          </Button>
        </form>
        {variables.data?.includes(name.trim()) && (
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
            {name.trim()} existiert bereits und wird überschrieben.
          </p>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">
            Variablen{variables.data ? ` (${variables.data.length})` : ""}
          </h3>
          <Input
            className="h-8 w-56 text-xs"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filtern…"
            aria-label="Variablen filtern"
          />
        </div>
        {variables.isPending ? (
          <p className="mt-3 text-xs text-muted-foreground">Variablen werden geladen…</p>
        ) : variables.isError ? (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {String(variables.error)}
          </p>
        ) : shown.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {variables.data.length === 0 ? "Keine Variablen vorhanden." : "Keine Treffer."}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border bg-background/50">
            <table className="w-full text-left">
              <thead className="text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Wert</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <ConvexEnvironmentRow
                    key={item}
                    deployment={deployment}
                    name={item}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {importing && (
        <ConvexEnvironmentImportDialog
          deployment={deployment}
          onClose={() => setImporting(false)}
          onImported={refresh}
        />
      )}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && !busy && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Umgebungsvariable löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget} wird aus {deployment.title} entfernt. Funktionen, die sie lesen,
              erhalten danach undefined.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (deleteTarget) void remove(deleteTarget);
              }}
            >
              {busy ? "Löscht…" : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={exporting} onOpenChange={setExporting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Werte im Klartext exportieren?</AlertDialogTitle>
            <AlertDialogDescription>
              Die .env-Datei enthält alle {variables.data?.length ?? 0} Variablen mit ihren Werten
              unverschlüsselt. Speichere sie nur an einem sicheren Ort.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => void exportFile()}>Exportieren</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

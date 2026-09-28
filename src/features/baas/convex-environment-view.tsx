import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function ConvexEnvironmentView({
  id,
  projectId,
  deploymentName,
}: {
  id: string;
  projectId: number;
  deploymentName: string;
}) {
  const queryClient = useQueryClient();
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.convex.environment");
  const queryKey = ["convex", id, "environment", projectId, deploymentName];
  const variables = useQuery({
    queryKey,
    queryFn: () => convexEnvironmentVariables(id, projectId, deploymentName),
  });
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function save() {
    const variable = name.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) {
      setError("Bitte einen gültigen Variablennamen eingeben.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await convexSetEnvironmentVariable(id, projectId, deploymentName, variable, value);
      setName("");
      setValue("");
      setSuccess(`${variable} gespeichert.`);
      await queryClient.invalidateQueries({ queryKey });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setBusy(true);
    setError(null);
    try {
      await convexDeleteEnvironmentVariable(id, projectId, deploymentName, target);
      setDeleteTarget(null);
      setSuccess(`${target} gelöscht.`);
      await queryClient.invalidateQueries({ queryKey });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t pt-3">
      <div ref={feature.ref} className="flex items-center gap-2">
        <h4 className="text-xs font-semibold">Umgebungsvariablen</h4>
        {feature.isNew && <NewBadge />}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Werte werden nicht angezeigt. Speichern ersetzt den Wert einer vorhandenen Variable.
      </p>
      {variables.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Variablen werden geladen…</p>
      ) : variables.isError ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {String(variables.error)}
        </p>
      ) : variables.data.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Keine Variablen vorhanden.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {variables.data.map((variable) => (
            <div
              key={variable}
              className="inline-flex max-w-full items-center rounded-lg border bg-card text-xs"
            >
              <span className="truncate px-2 py-1 font-mono" title={variable}>
                {variable}
              </span>
              <button
                type="button"
                aria-label={`${variable} löschen`}
                className="px-2 py-1 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteTarget(variable)}
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Input
          className="h-8 min-w-32 flex-1 font-mono text-xs"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Variablenname"
          placeholder="NAME"
          required
        />
        <Input
          className="h-8 min-w-32 flex-1 text-xs"
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Variablenwert"
          placeholder="Wert"
          autoComplete="off"
          required
        />
        <Button size="sm" type="submit" disabled={busy}>
          <Plus className="size-3.5" /> Speichern
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {success}
        </p>
      )}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Umgebungsvariable löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget} wird aus {deploymentName} entfernt. Laufende Funktionen können davon
              betroffen sein.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {busy ? "Löscht…" : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

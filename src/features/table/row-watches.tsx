import { useContext, useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { deleteWorkbenchRecord, saveWorkbenchRecord } from "@/lib/workbench/records";
import { RowWatchContext } from "@/lib/workbench/row-watch-context";
import {
  displayCurrentWatchedCell,
  displayWatchedCell,
  watchSnapshot,
} from "@/lib/workbench/row-watches";

export function RowWatches({ scope }: { scope: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { records, states, loading, error } = useContext(RowWatchContext);
  const changedRows = states.filter((state) => state.changed.length > 0).length;
  const feature = useNewFeatureVisibility<HTMLButtonElement>("table.rows.watch");
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="shrink-0 border-b px-3 py-1">
      <Button
        ref={feature.ref}
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        Beobachtete Datensätze ({records.length})
        {changedRows > 0 && <span className="text-primary"> · {changedRows} geändert</span>}
        {feature.isNew && <NewBadge />}
      </Button>
      {open && (
        <div className="max-h-56 space-y-2 overflow-auto py-2 text-xs">
          <p className="text-muted-foreground">
            Zeilen per Rechtsklick beobachten. Vergleich mit dem gespeicherten Stand nur für
            geladene Daten; keine automatische Abfrage. „Nicht geladen“ bedeutet nicht gelöscht.
          </p>
          {loading && <p role="status">Beobachtungen werden geladen…</p>}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {states.map(({ watch, row, changed }) => (
            <div key={watch.id} className="border-t pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all font-medium">{watch.name}</span>
                <span>
                  {!row
                    ? "Nicht geladen"
                    : changed.length
                      ? `${changed.length} Werte geändert`
                      : "Geladene Werte unverändert"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || !row}
                  onClick={() =>
                    void act(async () =>
                      saveWorkbenchRecord({
                        id: watch.id,
                        kind: "watch",
                        scope,
                        name: watch.name,
                        value: {
                          ...watch.value,
                          cells: {
                            ...watch.value.cells,
                            ...watchSnapshot(
                              row ?? {},
                              watch.value.keys,
                              Object.keys(watch.value.cells),
                            ).cells,
                          },
                        },
                      }),
                    )
                  }
                >
                  Stand übernehmen
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Beobachtung ${watch.name} entfernen`}
                  onClick={() => void act(() => deleteWorkbenchRecord(watch.id))}
                >
                  Entfernen
                </Button>
              </div>
              {changed.map((column) => (
                <p key={column} className="break-all font-mono">
                  {column}: {displayWatchedCell(watch.value.cells[column])} →{" "}
                  {displayCurrentWatchedCell(row?.[column])}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

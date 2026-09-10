import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useMemo, useState } from "react";
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
import type { SavedQuery } from "@/lib/saved-queries";
import { serializeSavedQueryExport } from "@/lib/saved-queries-transfer";

interface Props {
  open: boolean;
  queries: SavedQuery[];
  onOpenChange: (open: boolean) => void;
}

export function SavedQueriesExportDialog({ open, queries, onOpenChange }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(queries.map((query) => query.id)),
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = useMemo(
    () => queries.filter((query) => selected.has(query.id)),
    [queries, selected],
  );
  const allSelected = queries.length > 0 && chosen.length === queries.length;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportSelected() {
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      const path = await save({
        defaultPath: "l8db-queries.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await writeTextFile(path, serializeSavedQueryExport(chosen));
      toast.success(
        chosen.length === 1 ? "1 Query exportiert" : `${chosen.length} Queries exportiert`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Gespeicherte Queries exportieren</DialogTitle>
          <DialogDescription>
            Exportiert werden nur Name und SQL. Verbindungen, Passwörter und der Verlauf bleiben
            außen vor. Klick auf einen Eintrag zeigt das enthaltene SQL.
          </DialogDescription>
        </DialogHeader>
        {queries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Es gibt noch keine gespeicherten Queries.
          </p>
        ) : (
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            <label className="flex items-center gap-2 border-b pb-2 text-xs text-muted-foreground">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(value) =>
                  setSelected(
                    value === true ? new Set(queries.map((query) => query.id)) : new Set(),
                  )
                }
              />
              Alle auswählen
            </label>
            {queries.map((query) => (
              <div key={query.id} className="rounded-md px-1 py-1 hover:bg-muted/40">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selected.has(query.id)}
                    onCheckedChange={() => toggle(query.id)}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setExpanded(expanded === query.id ? null : query.id)}
                    title="SQL anzeigen"
                  >
                    <span className="block truncate text-sm">{query.name}</span>
                  </button>
                </div>
                {expanded === query.id && (
                  <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] whitespace-pre-wrap">
                    {query.sql}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={exportSelected} disabled={busy || chosen.length === 0}>
            {chosen.length === 1 ? "1 Query exportieren" : `${chosen.length} Queries exportieren`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

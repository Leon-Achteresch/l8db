import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/features/shell/workbench-dialog";
import type { ResultRun } from "@/lib/result-compare";
import {
  deleteResultSnapshot,
  listResultSnapshots,
  type ResultSnapshot,
  saveResultSnapshot,
  snapshotRun,
  subscribeResultSnapshots,
} from "@/lib/result-snapshots";

export function ResultSnapshotsDialog({
  open,
  onOpenChange,
  run,
  connectionId,
  database,
  onCompare,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: ResultRun | null;
  connectionId: string | null;
  database: string | null;
  onCompare: (run: ResultRun, name: string) => void;
}) {
  const [snapshots, setSnapshots] = useState<ResultSnapshot[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = async () => setSnapshots(await listResultSnapshots());
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoaded(false);
    setError(null);
    const refresh = () => {
      void listResultSnapshots()
        .then((items) => {
          if (active) {
            setSnapshots(items);
            setLoaded(true);
          }
        })
        .catch((failure) => {
          if (active) setError(String(failure));
        });
    };
    refresh();
    const unsubscribe = subscribeResultSnapshots(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [open]);
  const mutate = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Ergebnisstände</DialogTitle>
          <DialogDescription>
            Lokal auf diesem Gerät speichern und als Vergleichsbasis verwenden. Aktive Maskierungen
            werden übernommen. Maximal 10 Stände, je 999 Zeilen und 500.000 Zeichen; insgesamt 2
            Millionen Zeichen.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (run)
              void mutate(async () => {
                await saveResultSnapshot(name, run);
                setName("");
                toast.success("Ergebnisstand gespeichert");
              });
          }}
        >
          <Input
            aria-label="Name des Ergebnisstands"
            placeholder="Zum Beispiel: vor Migration"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={!run || busy}
          />
          <Button type="submit" disabled={!run || busy || !name.trim() || !loaded}>
            Speichern
          </Button>
        </form>
        {!run && (
          <p className="text-xs text-muted-foreground">
            Zum Speichern und Vergleichen wird ein erfolgreiches, vollständiges Ergebnis mit
            höchstens 999 Zeilen und 200 Spalten benötigt.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="max-h-80 space-y-2 overflow-auto">
          {!loaded && !error && (
            <p role="status" className="text-sm text-muted-foreground">
              Lade Ergebnisstände…
            </p>
          )}
          {loaded && snapshots.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              Noch keine Ergebnisstände gespeichert.
            </p>
          )}
          {snapshots.map((item) => {
            const sameTarget = item.connectionId === connectionId && item.database === database;
            return (
              <div
                key={item.id}
                className="flex flex-wrap items-center gap-2 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(item.at).toLocaleString("de-DE")} ·{" "}
                    {item.database ?? "Standarddatenbank"}
                    {!sameTarget && " · anderes Verbindungsziel"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !sameTarget || !run}
                  onClick={() => {
                    onCompare(snapshotRun(item), item.name);
                    onOpenChange(false);
                  }}
                >
                  Vergleichen
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`${item.name} löschen`}
                  onClick={() => void mutate(() => deleteResultSnapshot(item.id))}
                >
                  Löschen
                </Button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

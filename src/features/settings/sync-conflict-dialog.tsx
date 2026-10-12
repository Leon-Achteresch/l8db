import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ConflictStrategy, SyncConflict } from "@/lib/sync/merge";
import { SYNC_COLLECTION_LABELS } from "@/lib/sync/payload";

interface Props {
  conflicts: SyncConflict[] | null;
  onResolve: (strategy: ConflictStrategy | null) => void;
}

const VISIBLE = 50;

function stateLabel(entry: SyncConflict["local"], deletedAt: number | null): string {
  if (entry) return `geändert ${new Date(entry.updatedAt).toLocaleString("de-DE")}`;
  if (deletedAt) return `gelöscht ${new Date(deletedAt).toLocaleString("de-DE")}`;
  return "nicht vorhanden";
}

export function SyncConflictDialog({ conflicts, onResolve }: Props) {
  return (
    <Dialog
      open={conflicts !== null}
      onOpenChange={(open) => {
        if (!open) onResolve(null);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Synchronisationskonflikt</DialogTitle>
          <DialogDescription>
            {conflicts?.length ?? 0} Einträge wurden seit der letzten Synchronisierung auf diesem
            Rechner und auf dem Server geändert. Vor dem Übernehmen wird eine lokale Sicherung
            angelegt.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-auto rounded-md border text-xs">
          <table className="w-full">
            <thead className="sticky top-0 bg-muted text-left">
              <tr>
                <th className="p-2 font-medium">Eintrag</th>
                <th className="p-2 font-medium">Lokal</th>
                <th className="p-2 font-medium">Remote</th>
              </tr>
            </thead>
            <tbody>
              {conflicts?.slice(0, VISIBLE).map((conflict) => (
                <tr key={conflict.key} className="border-t">
                  <td className="p-2">
                    <div className="font-medium">{conflict.label}</div>
                    <div className="text-muted-foreground">
                      {SYNC_COLLECTION_LABELS[conflict.collection]}
                    </div>
                  </td>
                  <td className="p-2">{stateLabel(conflict.local, conflict.localDeletedAt)}</td>
                  <td className="p-2">{stateLabel(conflict.remote, conflict.remoteDeletedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {conflicts && conflicts.length > VISIBLE && (
            <p className="border-t p-2 text-muted-foreground">
              und {conflicts.length - VISIBLE} weitere
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          „Beide behalten“ legt bei Verbindungen, Abfragen, Snippets und Servergruppen eine Kopie
          mit dem Zusatz „(Remote)“ an. Bei Einstellungen gewinnt die neuere Änderung.
        </p>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onResolve(null)}>
            Abbrechen
          </Button>
          <Button variant="outline" onClick={() => onResolve("remote")}>
            Remote behalten
          </Button>
          <Button variant="outline" onClick={() => onResolve("local")}>
            Lokal behalten
          </Button>
          <Button onClick={() => onResolve("both")}>Beide behalten</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

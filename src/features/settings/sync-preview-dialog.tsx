import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SyncDecision } from "@/lib/sync/engine";
import { SYNC_COLLECTION_LABELS, SYNC_COLLECTIONS } from "@/lib/sync/payload";

interface Props {
  decision: Extract<SyncDecision, { kind: "preview" }> | null;
  onDecide: (accepted: boolean) => void;
}

export function SyncPreviewDialog({ decision, onDecide }: Props) {
  const rows = decision
    ? SYNC_COLLECTIONS.map((collection) => ({
        collection,
        ...decision.summary[collection],
      })).filter((row) => row.added + row.updated + row.removed > 0)
    : [];
  return (
    <Dialog
      open={decision !== null}
      onOpenChange={(open) => {
        if (!open) onDecide(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {decision?.mode === "download" ? "Lokale Daten ersetzen" : "Änderungen übernehmen"}
          </DialogTitle>
          <DialogDescription>
            Diese Änderungen werden lokal übernommen
            {decision?.remoteUpdatedAt
              ? ` (Stand ${new Date(decision.remoteUpdatedAt).toLocaleString("de-DE")})`
              : ""}
            . Vorher wird automatisch eine Sicherung angelegt, die Sie unter „Sicherungen“
            wiederherstellen können.
          </DialogDescription>
        </DialogHeader>
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Bereich</th>
              <th className="py-1 text-right font-medium">Neu</th>
              <th className="py-1 text-right font-medium">Geändert</th>
              <th className="py-1 text-right font-medium">Entfernt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.collection} className="border-t">
                <td className="py-1">{SYNC_COLLECTION_LABELS[row.collection]}</td>
                <td className="py-1 text-right tabular-nums">{row.added}</td>
                <td className="py-1 text-right tabular-nums">{row.updated}</td>
                <td
                  className={
                    row.removed > 0
                      ? "py-1 text-right tabular-nums text-destructive"
                      : "py-1 text-right tabular-nums"
                  }
                >
                  {row.removed}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {decision && decision.devicePaths.length > 0 && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
            {decision.devicePaths.length} übernommene Angaben sind gerätespezifische Pfade
            (SSH-Schlüssel, Agent-Sockets oder Datenbankdateien). Prüfen Sie diese auf diesem
            Rechner.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onDecide(false)}>
            Abbrechen
          </Button>
          <Button onClick={() => onDecide(true)}>Übernehmen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

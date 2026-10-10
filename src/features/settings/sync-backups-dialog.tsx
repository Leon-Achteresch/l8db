import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type SyncBackupInfo, syncBackupList } from "@/lib/db/sync";
import { errorMessage, restoreBackup } from "@/lib/sync/controller";
import { summaryTotal } from "@/lib/sync/payload";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const REASONS: Record<string, string> = {
  sync: "vor Synchronisierung",
  download: "vor Herunterladen",
  restore: "vor Wiederherstellung",
};

export function SyncBackupsDialog({ open, onOpenChange }: Props) {
  const [backups, setBackups] = useState<SyncBackupInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setBackups(null);
    syncBackupList()
      .then((list) => {
        if (active) setBackups(list);
      })
      .catch((error) => {
        if (active) {
          setBackups([]);
          toast.error(errorMessage(error));
        }
      });
    return () => {
      active = false;
    };
  }, [open]);
  const restore = async (id: string) => {
    setBusy(true);
    try {
      const summary = await restoreBackup(id);
      toast.success(`Sicherung wiederhergestellt (${summaryTotal(summary)} Änderungen)`);
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lokale Sicherungen</DialogTitle>
          <DialogDescription>
            Vor jedem Überschreiben lokaler Daten legt l8db eine Sicherung an. Die letzten zehn
            bleiben erhalten. Passwörter sind nicht enthalten.
          </DialogDescription>
        </DialogHeader>
        {backups === null ? (
          <p className="text-xs text-muted-foreground">Lade Sicherungen…</p>
        ) : backups.length === 0 ? (
          <p className="text-xs text-muted-foreground">Noch keine Sicherungen vorhanden.</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-auto text-xs">
            {backups.map((backup) => (
              <li
                key={backup.id}
                className="flex items-center justify-between gap-2 rounded-md border p-2"
              >
                <div>
                  <div className="font-medium">
                    {new Date(backup.createdAt).toLocaleString("de-DE")}
                  </div>
                  <div className="text-muted-foreground">
                    {REASONS[backup.reason] ?? backup.reason} · {Math.ceil(backup.size / 1024)} KB
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void restore(backup.id)}
                >
                  Wiederherstellen
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

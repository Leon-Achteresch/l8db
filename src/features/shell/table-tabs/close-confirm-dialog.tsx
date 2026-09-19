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
import type { PendingClose } from "./use-tab-close";

interface CloseConfirmDialogProps {
  pendingClose: PendingClose;
  setPendingClose: (value: PendingClose) => void;
  savingClose: boolean;
  saveAndClose: () => Promise<void>;
  executeClose: (pending: NonNullable<PendingClose>) => void;
}

export function CloseConfirmDialog({
  pendingClose,
  setPendingClose,
  savingClose,
  saveAndClose,
  executeClose,
}: CloseConfirmDialogProps) {
  return (
    <AlertDialog
      open={pendingClose !== null}
      onOpenChange={(open) => {
        if (!open && !savingClose) setPendingClose(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ungespeicherte Änderungen</AlertDialogTitle>
          <AlertDialogDescription>
            SQL-Dateien und Entwürfe wurden noch nicht gespeichert. Geschlossene Tabs bleiben in der
            Entwurfswiederherstellung verfügbar.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={savingClose}>Abbrechen</AlertDialogCancel>
          <Button disabled={savingClose} onClick={() => void saveAndClose()}>
            {savingClose ? "Speichern…" : "Speichern und schließen"}
          </Button>
          <AlertDialogAction
            variant="destructive"
            disabled={savingClose}
            onClick={() => {
              if (!pendingClose) return;
              const pending = pendingClose;
              setPendingClose(null);
              executeClose(pending);
            }}
          >
            Verwerfen und schließen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

import { toast } from "sonner";
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
import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { useTableTabs } from "@/lib/table-tabs";
import { getTransactionForConnection } from "@/lib/transactions";

export function DeleteConnectionDialog({
  deleting,
  deleteId,
  setDeleteId,
  editorId,
  setEditorId,
}: {
  deleting: SavedConnection | undefined;
  deleteId: string | null;
  setDeleteId: (id: string | null) => void;
  editorId: string | null;
  setEditorId: (id: string | null) => void;
}) {
  return (
    <AlertDialog
      open={Boolean(deleting)}
      onOpenChange={(open) => {
        if (!open) setDeleteId(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Verbindung entfernen?</AlertDialogTitle>
          <AlertDialogDescription>
            „{deleting?.name}“ und die gespeicherten Zugangsdaten werden aus l8db entfernt. Die
            Datenbank selbst bleibt erhalten.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (deleteId) {
                if (getTransactionForConnection(deleteId)) {
                  toast.error("Schließe zuerst die offene Transaktion ab.");
                  return;
                }
                useConnectionsStore.getState().removeConnection(deleteId);
                useTableTabs.getState().clearTabsForConnection(deleteId);
                if (editorId === deleteId || !useConnectionsStore.getState().connections.length)
                  setEditorId(null);
                toast.success("Verbindung entfernt");
                setDeleteId(null);
              }
            }}
          >
            Entfernen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

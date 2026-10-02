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
import {
  connectionRemovalBlocker,
  unsavedQueryTabCount,
  unsavedQueryTabsNotice,
} from "./connection-removal";

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
  const tabsNotice = unsavedQueryTabsNotice(deleteId ? unsavedQueryTabCount([deleteId]) : 0);
  return (
    <AlertDialog
      open={Boolean(deleting)}
      onOpenChange={(open) => {
        if (!open) setDeleteId(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {deleting?.vault ? "Verbindung ausblenden?" : "Verbindung entfernen?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deleting?.vault
              ? `„${deleting.name}“ wird in l8db ausgeblendet. Der Eintrag im Passwortmanager bleibt unverändert und lässt sich über „Ausgeblendete einblenden“ zurückholen.${tabsNotice}`
              : `„${deleting?.name}“ und die gespeicherten Zugangsdaten werden aus l8db entfernt. Die Datenbank selbst bleibt erhalten.${tabsNotice}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              if (!deleteId) return;
              const blocker = await connectionRemovalBlocker([deleteId]);
              if (blocker) {
                toast.error(blocker);
                return;
              }
              useConnectionsStore.getState().removeConnection(deleteId);
              useTableTabs.getState().clearTabsForConnection(deleteId);
              if (editorId === deleteId || !useConnectionsStore.getState().connections.length)
                setEditorId(null);
              toast.success(deleting?.vault ? "Verbindung ausgeblendet" : "Verbindung entfernt");
              setDeleteId(null);
            }}
          >
            {deleting?.vault ? "Ausblenden" : "Entfernen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

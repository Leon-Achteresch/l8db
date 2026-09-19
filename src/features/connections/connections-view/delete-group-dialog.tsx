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
import type { ServerGroup } from "@/lib/connection-groups";
import { useConnectionsStore } from "@/lib/connections";
import { useTableTabs } from "@/lib/table-tabs";
import { getTransactionForConnection } from "@/lib/transactions";

export function DeleteServerGroupDialog({
  deleteGroup,
  setDeleteGroup,
  editorId,
  setEditorId,
}: {
  deleteGroup: ServerGroup | null;
  setDeleteGroup: (group: ServerGroup | null) => void;
  editorId: string | null;
  setEditorId: (id: string | null) => void;
}) {
  return (
    <AlertDialog
      open={Boolean(deleteGroup)}
      onOpenChange={(open) => {
        if (!open) setDeleteGroup(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Alle Verbindungen entfernen?</AlertDialogTitle>
          <AlertDialogDescription>
            Alle {deleteGroup?.connections.length} Verbindungen auf „{deleteGroup?.label}“ und die
            gespeicherten Zugangsdaten werden aus l8db entfernt. Die Datenbank selbst bleibt
            erhalten.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (!deleteGroup) return;
              const ids = deleteGroup.connections.map((connection) => connection.id);
              if (ids.some((id) => getTransactionForConnection(id))) {
                toast.error("Schließe zuerst die offenen Transaktionen ab.");
                return;
              }
              for (const id of ids) {
                useConnectionsStore.getState().removeConnection(id);
                useTableTabs.getState().clearTabsForConnection(id);
              }
              if (!useConnectionsStore.getState().connections.length) setEditorId(null);
              else if (editorId && ids.includes(editorId)) setEditorId(null);
              toast.success(`${ids.length} Verbindungen entfernt`);
              setDeleteGroup(null);
            }}
          >
            Alle entfernen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

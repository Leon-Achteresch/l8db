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
import { Spinner } from "@/components/ui/spinner";

export interface EntityConfirmAction {
  kind: "drop" | "truncate";
  schema: string;
  name: string;
}

interface EntityConfirmDialogProps {
  confirmAction: EntityConfirmAction | null;
  actionLoading: boolean;
  isRedis: boolean;
  activeDatabase: string | null | undefined;
  onClose: () => void;
  onConfirm: () => void;
}

export function EntityConfirmDialog({
  confirmAction,
  actionLoading,
  isRedis,
  activeDatabase,
  onClose,
  onConfirm,
}: EntityConfirmDialogProps) {
  return (
    <AlertDialog
      open={confirmAction !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isRedis
              ? `Alle Keys in Datenbank ${activeDatabase ?? "0"} löschen?`
              : confirmAction?.kind === "drop"
                ? `Tabelle "${confirmAction.name}" löschen?`
                : `Alle Daten in "${confirmAction?.name}" löschen?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isRedis
              ? "Alle Keys der ausgewählten Redis-Datenbank werden unwiderruflich gelöscht (FLUSHDB)."
              : confirmAction?.kind === "drop"
                ? "Die Tabelle und alle enthaltenen Daten werden unwiderruflich gelöscht (DROP TABLE CASCADE)."
                : "Alle Zeilen in dieser Tabelle werden unwiderruflich gelöscht (TRUNCATE TABLE). Die Tabellenstruktur bleibt erhalten."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={actionLoading}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={actionLoading}>
            {actionLoading ? <Spinner className="size-4" /> : null}
            {confirmAction?.kind === "drop" ? "Drop Table" : "Delete All"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

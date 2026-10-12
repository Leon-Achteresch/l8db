import { useEffect, useId, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [confirmation, setConfirmation] = useState("");
  const id = useId();
  const expected = isRedis ? (activeDatabase ?? "0") : (confirmAction?.name ?? "");
  useEffect(() => {
    setConfirmation("");
  }, [confirmAction]);
  return (
    <AlertDialog
      open={confirmAction !== null}
      onOpenChange={(open) => {
        if (!open && !actionLoading) onClose();
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
        <div className="space-y-2">
          <Label htmlFor={id}>Zum Bestätigen „{expected}“ eingeben</Label>
          <Input
            id={id}
            value={confirmation}
            disabled={actionLoading}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={actionLoading}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              if (confirmation === expected) onConfirm();
            }}
            disabled={actionLoading || confirmation !== expected}
          >
            {actionLoading ? <Spinner className="size-4" /> : null}
            {confirmAction?.kind === "drop" ? "Tabelle löschen" : "Alle Daten löschen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

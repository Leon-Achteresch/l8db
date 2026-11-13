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
import type { Terms } from "@/lib/db";

export interface EntityConfirmAction {
  kind: "drop" | "truncate";
  schema: string;
  name: string;
}

interface EntityConfirmDialogProps {
  confirmAction: EntityConfirmAction | null;
  actionLoading: boolean;
  isRedis: boolean;
  terms: Terms;
  activeDatabase: string | null | undefined;
  onClose: () => void;
  onConfirm: () => void;
}

export function EntityConfirmDialog({
  confirmAction,
  actionLoading,
  isRedis,
  terms,
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
                ? `${terms.table} "${confirmAction.name}" löschen?`
                : `Alle ${terms.rows} in "${confirmAction?.name}" löschen?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isRedis
              ? "Alle Keys der ausgewählten Redis-Datenbank werden unwiderruflich gelöscht (FLUSHDB)."
              : confirmAction?.kind === "drop"
                ? `${terms.table} und alle ${terms.rows} werden unwiderruflich gelöscht.`
                : `Alle ${terms.rows} werden unwiderruflich gelöscht. Die Struktur bleibt erhalten.`}
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
            {confirmAction?.kind === "drop"
              ? `${terms.table} löschen`
              : `Alle ${terms.rows} löschen`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

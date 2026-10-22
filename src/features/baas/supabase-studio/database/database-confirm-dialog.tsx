import { useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { DatabaseAction } from "@/lib/db/supabase-studio-database";
import { useDatabaseAction } from "./use-database-action";

export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel?: string;
  action: DatabaseAction;
  cascade?: boolean;
}

export function DatabaseConfirmDialog({
  reference,
  request,
  onClose,
}: {
  reference: string;
  request: ConfirmRequest | null;
  onClose: () => void;
}) {
  const mutation = useDatabaseAction(reference);
  const [cascade, setCascade] = useState(false);
  const confirm = () => {
    if (!request) return;
    const action = request.cascade
      ? ({ ...request.action, cascade } as DatabaseAction)
      : request.action;
    mutation.mutate(action, {
      onSuccess: () => {
        setCascade(false);
        onClose();
      },
    });
  };
  return (
    <AlertDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCascade(false);
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription>{request?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {request?.cascade && (
          <Label className="flex items-center gap-2 text-xs">
            <Checkbox checked={cascade} onCheckedChange={(value) => setCascade(value === true)} />
            Abhängige Objekte mitlöschen (CASCADE)
          </Label>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              confirm();
            }}
          >
            {request?.confirmLabel ?? "Löschen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

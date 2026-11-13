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
import type { PrincipalKind } from "@/lib/db";

interface DropPrincipalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: PrincipalKind;
  name: string;
  onDrop: (cascade: boolean) => void;
}

const CASCADE_LABEL: Partial<Record<PrincipalKind, string>> = {
  user: "Mit allen Objekten des Schemas (CASCADE)",
  profile: "Zugewiesene Benutzer auf DEFAULT setzen (CASCADE)",
};

export function DropPrincipalDialog({
  open,
  onOpenChange,
  kind,
  name,
  onDrop,
}: DropPrincipalDialogProps) {
  const [cascade, setCascade] = useState(false);
  const label = CASCADE_LABEL[kind];
  const statement = `DROP ${kind.toUpperCase()} "${name}"${cascade && label ? " CASCADE" : ""}`;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{name} löschen?</AlertDialogTitle>
          <AlertDialogDescription className="font-mono text-xs">{statement}</AlertDialogDescription>
        </AlertDialogHeader>
        {label && (
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <Checkbox checked={cascade} onCheckedChange={(on) => setCascade(on === true)} />
            {label}
          </label>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => onDrop(cascade)}>
            Löschen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

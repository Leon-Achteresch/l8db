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
import { Checkbox } from "@/components/ui/checkbox";

export function ExtensionUninstallDialog({
  name,
  onClose,
  onConfirm,
}: {
  name: string | null;
  onClose: () => void;
  onConfirm: (name: string, cascade: boolean) => void;
}) {
  const [cascade, setCascade] = useState(false);
  const id = useId();
  useEffect(() => {
    if (name) setCascade(false);
  }, [name]);
  return (
    <AlertDialog
      open={name !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Extension „{name}“ deinstallieren?</AlertDialogTitle>
          <AlertDialogDescription>
            Ohne CASCADE bricht PostgreSQL ab, wenn Spalten, Views, Funktionen oder Defaults die
            Extension noch nutzen, und nennt sie in der Fehlermeldung.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-start gap-2.5">
          <Checkbox
            id={id}
            className="mt-0.5"
            checked={cascade}
            onCheckedChange={(checked) => setCascade(checked === true)}
          />
          <label htmlFor={id} className="text-xs">
            <span className="block font-medium">Abhängige Objekte mitlöschen (CASCADE)</span>
            <span className="block text-muted-foreground">
              Entfernt alle Objekte, die die Extension nutzen, samt ihren Daten. Nicht umkehrbar.
            </span>
          </label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant={cascade ? "destructive" : "default"}
            onClick={() => {
              if (name) onConfirm(name, cascade);
            }}
          >
            {cascade ? "Mit abhängigen Objekten löschen" : "Deinstallieren"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

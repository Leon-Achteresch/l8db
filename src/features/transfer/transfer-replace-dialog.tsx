import { useId, useState } from "react";
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
import type { TransferPlan } from "@/lib/db";

export function TransferReplaceDialog({
  plan,
  open,
  onOpenChange,
  onConfirm,
}: {
  plan: TransferPlan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const [confirmation, setConfirmation] = useState("");
  const expected = [...new Set(plan.schemas.map((pair) => pair.target))].join(", ");
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setConfirmation("");
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ziel „{expected}“ überschreiben?</AlertDialogTitle>
          <AlertDialogDescription>
            {plan.replaced.length} Objekte im Ziel werden mit allen Daten unwiderruflich gelöscht
            und durch die Quelle ersetzt. Schlägt die Übertragung fehl, bleibt das Zielschema leer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor={id}>Zum Bestätigen „{expected}“ eingeben</Label>
          <Input
            id={id}
            value={confirmation}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={confirmation !== expected}
            onClick={() => {
              setConfirmation("");
              onConfirm();
            }}
          >
            Überschreiben
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

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

export interface ConfirmOption {
  id: string;
  label: string;
}

export function SupabaseTableConfirmDialog({
  open,
  title,
  description,
  action,
  options = [],
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  action: string;
  options?: ConfirmOption[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (options: Record<string, boolean>) => Promise<void>;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(checked);
      setChecked({});
      onOpenChange(false);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setError(null);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {options.map((option) => (
          <Label key={option.id} className="flex items-center gap-2 text-sm font-normal">
            <Checkbox
              checked={Boolean(checked[option.id])}
              onCheckedChange={(value) =>
                setChecked((current) => ({ ...current, [option.id]: value === true }))
              }
            />
            {option.label}
          </Label>
        ))}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            {busy ? "Läuft…" : action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

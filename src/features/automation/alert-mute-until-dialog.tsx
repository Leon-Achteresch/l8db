import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  name: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (until: Date) => void;
}

function localValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AlertMuteUntilDialog({ open, name, onOpenChange, onConfirm }: Props) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!open) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);
    setValue(localValue(tomorrow));
  }, [open]);

  const until = value ? new Date(value) : null;
  const valid = Boolean(until && Number.isFinite(until.getTime()) && until.getTime() > Date.now());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (until && valid) onConfirm(until);
          }}
        >
          <DialogHeader>
            <DialogTitle>Stummschalten bis …</DialogTitle>
            <DialogDescription>
              „{name}“ wird weiter geprüft, sendet aber bis dahin keine Benachrichtigungen.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="alert-mute-until">Zeitpunkt</Label>
            <Input
              id="alert-mute-until"
              type="datetime-local"
              value={value}
              min={localValue(new Date())}
              onChange={(event) => setValue(event.target.value)}
              aria-invalid={value !== "" && !valid}
            />
            {value !== "" && !valid && (
              <p className="text-xs text-destructive">
                Bitte einen Zeitpunkt in der Zukunft wählen.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={!valid}>
              Stummschalten
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

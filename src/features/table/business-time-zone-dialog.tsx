import { useId, useRef, useState } from "react";
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
import { useQueryQolSettings } from "@/lib/query-qol-settings";
import { normalizeBusinessTimeZone } from "@/lib/timestamp-display";

export function BusinessTimeZoneDialog({
  onClose,
  returnFocus,
}: {
  onClose: () => void;
  returnFocus: () => void;
}) {
  const saved = useQueryQolSettings((state) => state.timestamps.timeZone);
  const [error, setError] = useState(false);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-sm"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Fachliche Zeitzone</DialogTitle>
          <DialogDescription>Anzeige für PostgreSQL-Zeitstempel mit Zeitzone.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const timeZone = normalizeBusinessTimeZone(input.current?.value);
            if (!timeZone) {
              setError(true);
              input.current?.focus();
              return;
            }
            const { timestamps, setTimestamps } = useQueryQolSettings.getState();
            setTimestamps({ ...timestamps, mode: "business", timeZone });
            onClose();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={id}>IANA-Zeitzone</Label>
            <Input
              ref={input}
              id={id}
              className="font-mono"
              defaultValue={saved}
              placeholder="America/New_York"
              maxLength={96}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error || undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={() => setError(false)}
            />
            {error && (
              <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
                IANA-Zeitzone nicht erkannt. Verwende einen Namen wie America/New_York.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit">Anzeigen</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

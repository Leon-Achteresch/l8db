import { OctagonAlertIcon } from "lucide-react";
import { useState } from "react";
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

export function AiProductionConfirmDialog({
  name,
  level,
  onConfirm,
  onClose,
}: {
  name: string;
  level: "write" | "ddl";
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState("");
  const ready = typed === name;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (step === 1) {
              setStep(2);
              return;
            }
            if (!ready) return;
            onConfirm();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <OctagonAlertIcon className="size-4 shrink-0 text-destructive" />
              {step === 1 ? "KI darf Produktion ändern?" : "Schritt 2 von 2: Freigabe bestätigen"}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              <span className="font-medium text-foreground">{name}</span> ist als Produktion
              markiert.{" "}
              {level === "ddl"
                ? "Mit „Schema ändern“ darf die KI Daten ändern und Tabellen anlegen, ändern und löschen."
                : "Mit „Daten ändern“ darf die KI INSERT, UPDATE und DELETE ausführen."}{" "}
              Jede Änderung musst du weiterhin einzeln freigeben. Die Freigabe gilt nur für diese
              Verbindung in diesem Gespräch. Ist unter MCP „Produktion beschreiben“ aus, bleibt die
              Verbindung trotzdem gesperrt.
            </DialogDescription>
          </DialogHeader>
          {step === 2 && (
            <label className="block space-y-1.5 text-xs">
              <span className="text-muted-foreground">
                Zur Bestätigung <span className="font-mono text-foreground">{name}</span> eingeben
              </span>
              <Input
                autoFocus
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                aria-label="Verbindungsname zur Bestätigung"
                className="font-mono"
              />
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" size="sm" variant="destructive" disabled={step === 2 && !ready}>
              {step === 1 ? "Weiter" : "Schreibzugriff freigeben"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

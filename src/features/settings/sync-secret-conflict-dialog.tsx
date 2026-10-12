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
import type { SecretConflict, SecretResolutions } from "@/lib/sync/engine";

interface Props {
  conflicts: SecretConflict[] | null;
  onResolve: (resolutions: SecretResolutions | null) => void;
}

type Choice = "local" | "remote" | "later";

const CHOICES: { value: Choice; label: string }[] = [
  { value: "local", label: "Lokal behalten" },
  { value: "remote", label: "Vom Server" },
  { value: "later", label: "Später" },
];

export function SyncSecretConflictDialog({ conflicts, onResolve }: Props) {
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const finish = () => {
    const resolutions: SecretResolutions = {};
    for (const [account, choice] of Object.entries(choices))
      if (choice !== "later") resolutions[account] = choice;
    setChoices({});
    onResolve(resolutions);
  };
  return (
    <Dialog
      open={conflicts !== null}
      onOpenChange={(open) => {
        if (!open) {
          setChoices({});
          onResolve(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Abweichende Passwörter</DialogTitle>
          <DialogDescription>
            Dieser Rechner wurde noch nie mit diesen Passwörtern abgeglichen, und die Werte
            unterscheiden sich vom Server. Wählen Sie je Eintrag, welcher Wert gilt. Überschriebene
            Passwörter werden vorher verschlüsselt gesichert. „Später“ lässt beide Seiten
            unverändert.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-72 space-y-1 overflow-auto text-xs">
          {conflicts?.map((conflict) => {
            const current = choices[conflict.account] ?? "later";
            return (
              <li
                key={conflict.account}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
              >
                <div>
                  <div className="font-medium">{conflict.label}</div>
                  <div className="text-muted-foreground">{conflict.kind}</div>
                </div>
                <div className="flex gap-1">
                  {CHOICES.map((choice) => (
                    <Button
                      key={choice.value}
                      size="sm"
                      variant={current === choice.value ? "secondary" : "ghost"}
                      className="h-7 text-xs"
                      aria-pressed={current === choice.value}
                      onClick={() =>
                        setChoices((previous) => ({
                          ...previous,
                          [conflict.account]: choice.value,
                        }))
                      }
                    >
                      {choice.label}
                    </Button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setChoices({});
              onResolve(null);
            }}
          >
            Alle später
          </Button>
          <Button onClick={finish}>Übernehmen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

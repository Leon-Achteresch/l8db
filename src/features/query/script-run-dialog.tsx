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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ScriptRunMode = "existing-transaction" | "new-transaction" | "autocommit";

export const SCRIPT_RUN_MODE_TEXT: Record<ScriptRunMode, string> = {
  "existing-transaction":
    "Es läuft bereits eine offene Transaktion für diese Verbindung. Alle Statements laufen darin mit; ein zweiter unabhängiger Ablauf ist nicht möglich. Commit oder Rollback erfolgt weiterhin über das Transaktionspanel.",
  "new-transaction":
    "Das Skript startet eine verwaltete Transaktion. Nichts wird automatisch committet; Commit oder Rollback erfolgt danach über das Transaktionspanel.",
  autocommit:
    "Jedes Statement wird sofort und endgültig ausgeführt (Autocommit). Ein Rollback ist nicht möglich.",
};

interface ScriptRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statementCount: number;
  mode: ScriptRunMode;
  unterminated: boolean;
  onConfirm: (mode: ScriptRunMode, stopOnError: boolean) => void;
  transactions?: boolean;
}

export function ScriptRunDialog({
  open,
  onOpenChange,
  statementCount,
  mode,
  unterminated,
  onConfirm,
  transactions = false,
}: ScriptRunDialogProps) {
  const [selectedMode, setSelectedMode] = useState(mode);
  const [stopOnError, setStopOnError] = useState(true);
  useEffect(() => {
    if (open) {
      setSelectedMode(mode);
      setStopOnError(true);
    }
  }, [open, mode]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Skript ausführen</DialogTitle>
          <DialogDescription>
            {statementCount} Statement{statementCount === 1 ? "" : "s"} werden nacheinander in der
            Reihenfolge des Editors ausgeführt.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-xs">
          <div className="grid gap-2">
            Transaktion
            <Select
              value={String(selectedMode)}
              onValueChange={(selectedValue) => {
                setSelectedMode(selectedValue as ScriptRunMode);
              }}
              disabled={mode === "existing-transaction"}
            >
              <SelectTrigger
                aria-label="Skript-Transaktion"
                className="rounded border bg-background p-2"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mode === "existing-transaction" ? (
                  <SelectItem value="existing-transaction">Offene Transaktion verwenden</SelectItem>
                ) : (
                  <>
                    <SelectItem value="autocommit">Autocommit</SelectItem>
                    {transactions && (
                      <SelectItem value="new-transaction">
                        Neue Transaktion, danach prüfen
                      </SelectItem>
                    )}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          <p>{SCRIPT_RUN_MODE_TEXT[selectedMode]}</p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selectedMode !== "autocommit" || stopOnError}
              disabled={selectedMode !== "autocommit"}
              onChange={(event) => setStopOnError(event.target.checked)}
            />
            Bei Fehler stoppen
          </label>
          <p>
            In einer Transaktion stoppt der Ablauf beim ersten Fehler. Bei Autocommit können Sie das
            Fortsetzen ausdrücklich wählen.
          </p>
          {unterminated && (
            <p className="text-amber-600 dark:text-amber-400">
              Das Skript enthält ein nicht abgeschlossenes Literal oder einen offenen Kommentar.
              Bitte schließen Sie es vor der Ausführung.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            size="sm"
            onClick={() => onConfirm(selectedMode, selectedMode !== "autocommit" || stopOnError)}
            disabled={statementCount === 0 || unterminated}
          >
            Skript ausführen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

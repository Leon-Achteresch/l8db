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

export const SQLPLUS_MODE_TEXT: Record<ScriptRunMode, string> = {
  "existing-transaction":
    "Wie SQL*Plus in der offenen Transaktion: COMMIT, ROLLBACK, WHENEVER SQLERROR … und EXIT im Skript schließen sie ab; DDL committet implizit.",
  "new-transaction":
    "Wie SQL*Plus: Autocommit ist aus. COMMIT, ROLLBACK, WHENEVER SQLERROR … und EXIT wirken im Skript, DDL committet implizit. Was am Ende offen ist, bleibt im Transaktionspanel.",
  autocommit:
    "Wie SET AUTOCOMMIT ON: Jedes Statement wird sofort festgeschrieben. ROLLBACK und WHENEVER … ROLLBACK können nichts zurücknehmen.",
};

interface ScriptRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statementCount: number;
  mode: ScriptRunMode;
  unterminated: boolean;
  onConfirm: (mode: ScriptRunMode, stopOnError: boolean) => void;
  transactions?: boolean;
  sqlplus?: boolean;
}

export function ScriptRunDialog({
  open,
  onOpenChange,
  statementCount,
  mode,
  unterminated,
  onConfirm,
  transactions = false,
  sqlplus = false,
}: ScriptRunDialogProps) {
  const [selectedMode, setSelectedMode] = useState(mode);
  const forcedStop = selectedMode !== "autocommit" && !sqlplus;
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
                        {sqlplus
                          ? "SQL*Plus: Autocommit aus, Transaktion prüfen"
                          : "Neue Transaktion, danach prüfen"}
                      </SelectItem>
                    )}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          <p>{(sqlplus ? SQLPLUS_MODE_TEXT : SCRIPT_RUN_MODE_TEXT)[selectedMode]}</p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={forcedStop || stopOnError}
              disabled={forcedStop}
              onChange={(event) => setStopOnError(event.target.checked)}
            />
            Bei Fehler stoppen
          </label>
          <p>
            {sqlplus
              ? "Gilt, bis das Skript WHENEVER SQLERROR oder WHENEVER OSERROR setzt; danach entscheidet das Skript wie in SQL*Plus. Statements laufen wie in SQL*Plus ohne Zeitlimit, Abbrechen über Stopp."
              : "In einer Transaktion stoppt der Ablauf beim ersten Fehler. Bei Autocommit können Sie das Fortsetzen ausdrücklich wählen."}
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
            onClick={() => onConfirm(selectedMode, forcedStop || stopOnError)}
            disabled={statementCount === 0 || unterminated}
          >
            Skript ausführen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

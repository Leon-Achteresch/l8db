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
    "Läuft in der offenen Transaktion. Commit oder Rollback im Transaktionspanel.",
  "new-transaction":
    "Nichts wird automatisch committet. Commit oder Rollback im Transaktionspanel.",
  autocommit: "Jedes Statement wird sofort festgeschrieben, kein Rollback.",
};

export const SQLPLUS_MODE_TEXT: Record<ScriptRunMode, string> = {
  "existing-transaction": "Wie SQL*Plus in der offenen Transaktion. DDL committet implizit.",
  "new-transaction":
    "Wie SQL*Plus: Autocommit ist aus. DDL committet implizit, Offenes bleibt im Transaktionspanel.",
  autocommit: "Wie SET AUTOCOMMIT ON: Jedes Statement wird sofort festgeschrieben.",
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
          <label
            className="flex items-center gap-2"
            title={
              sqlplus
                ? "Bis das Skript WHENEVER SQLERROR oder WHENEVER OSERROR setzt"
                : "In einer Transaktion immer"
            }
          >
            <input
              type="checkbox"
              checked={forcedStop || stopOnError}
              disabled={forcedStop}
              onChange={(event) => setStopOnError(event.target.checked)}
            />
            Bei Fehler stoppen
          </label>
          {unterminated && (
            <p className="text-amber-600 dark:text-amber-400">
              Literal oder Kommentar nicht abgeschlossen.
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

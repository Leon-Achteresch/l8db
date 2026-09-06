import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  onConfirm: () => void;
}

export function ScriptRunDialog({
  open,
  onOpenChange,
  statementCount,
  mode,
  unterminated,
  onConfirm,
}: ScriptRunDialogProps) {
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
          <p>{SCRIPT_RUN_MODE_TEXT[mode]}</p>
          <p>
            Beim ersten Fehler stoppt der Ablauf; die restlichen Statements bleiben unausgeführt und
            werden in der Ergebnisliste als solche gekennzeichnet.
          </p>
          {unterminated && (
            <p className="text-amber-600 dark:text-amber-400">
              Das Skript enthält ein nicht abgeschlossenes Literal oder einen offenen Kommentar. Es
              können nur die davor liegenden Statements ausgeführt werden.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={statementCount === 0}>
            Skript ausführen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

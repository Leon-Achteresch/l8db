import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const transactionLabels = {
  assigned: "Verwaltete Transaktion zugeordnet",
  finalizing: "Verwaltete Transaktion wird abgeschlossen",
  unassigned: "Keine verwaltete Transaktion zugeordnet",
};

export type PostgresTransactionStatus = keyof typeof transactionLabels;

export function PostgresTransactionContextDialog({
  transaction,
  hasResult,
  onClose,
  onRestoreFocus,
}: {
  transaction: PostgresTransactionStatus;
  hasResult: boolean;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-auto p-5 sm:max-w-md"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>PostgreSQL-Lesekontext</DialogTitle>
          <DialogDescription>
            Das Isolationslevel bestimmt, welche Änderungen ein erneutes SELECT sehen kann.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid gap-3 rounded-lg bg-muted/40 px-3 py-2.5 text-sm" aria-live="polite">
          <div>
            <dt className="text-xs text-muted-foreground">Aktueller Editor</dt>
            <dd>{transactionLabels[transaction]}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Isolationslevel</dt>
            <dd>Unbekannt</dd>
          </div>
          {hasResult && (
            <div>
              <dt className="text-xs text-muted-foreground">Vorhandenes Ergebnis</dt>
              <dd>Transaktionszuordnung unbekannt</dd>
            </div>
          )}
        </dl>
        <DialogFooter>
          <DialogClose asChild>
            <Button size="sm" variant="secondary">
              Schließen
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

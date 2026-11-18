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

const operators = [
  {
    symbol: "<->",
    title: "L2-Distanz",
    description: "Kleinere euklidische Abstände stehen zuerst.",
  },
  {
    symbol: "<#>",
    title: "Negatives Skalarprodukt",
    description: "Kleinere Werte entsprechen größeren Skalarprodukten.",
    formula: "-(a <#> b)",
    result: "Skalarprodukt",
  },
  {
    symbol: "<=>",
    title: "Kosinusdistanz",
    description: "Kleinere Distanzen entsprechen größerer Kosinusähnlichkeit.",
    formula: "1 - (a <=> b)",
    result: "Kosinusähnlichkeit",
  },
];

export function PgvectorReferenceDialog({
  onClose,
  onRestoreFocus,
}: {
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-auto p-5 sm:max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>pgvector-Referenz für PostgreSQL</DialogTitle>
          <DialogDescription>
            Gilt für die Erweiterung pgvector. Installation und Operatorzuordnung im aktuellen SQL
            bleiben ungeprüft.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          <code className="text-foreground">ORDER BY … ASC</code> sortiert nach dem kleinsten
          Operatorergebnis zuerst.
        </p>
        <dl className="grid gap-2">
          {operators.map(({ symbol, title, description, formula, result }) => (
            <div key={symbol} className="grid gap-1 rounded-lg bg-muted/40 px-3 py-2">
              <dt className="flex items-baseline gap-3 text-sm font-medium">
                <code className="shrink-0">{symbol}</code>
                <span>{title}</span>
              </dt>
              <dd className="text-xs leading-relaxed text-muted-foreground">{description}</dd>
              {formula && (
                <dd className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                  <code className="text-foreground">{formula}</code>
                  <span>{result}</span>
                </dd>
              )}
            </div>
          ))}
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

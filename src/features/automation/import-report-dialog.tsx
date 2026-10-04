import { CircleCheckIcon, ShieldAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ImportReport } from "@/lib/db/automation";

interface Props {
  report: ImportReport | null;
  onClose: () => void;
}

export function ImportReportDialog({ report, onClose }: Props) {
  const count = report?.imported.length ?? 0;
  const review = report?.needsReview ?? [];
  const renamed = report?.renamed ?? [];

  return (
    <Dialog open={Boolean(report)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {count === 1 ? "1 Task importiert" : `${count} Tasks importiert`}
          </DialogTitle>
          <DialogDescription>
            {review.length
              ? "Einige Tasks bleiben deaktiviert, bis du sie geprüft hast."
              : "Alle Tasks sind angelegt und können sofort genutzt werden."}
          </DialogDescription>
        </DialogHeader>
        {review.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
              <ShieldAlertIcon aria-hidden className="size-3.5" />
              Muss geprüft werden
            </p>
            <p className="mt-1 text-xs text-pretty text-amber-900/80 dark:text-amber-200/80">
              Sie führen Programme aus, senden Daten nach außen, löschen Dateien oder haben
              Zeitpläne. Öffne jeden Task, prüfe die Schritte und aktiviere ihn dann.
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {review.map((name) => (
                <li key={name} className="truncate text-[13px] font-medium">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        )}
        {renamed.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              Wegen Namensgleichheit umbenannt
            </p>
            <ul className="flex flex-col gap-0.5">
              {renamed.map((name) => (
                <li key={name} className="flex items-center gap-1.5 truncate text-[13px]">
                  <CircleCheckIcon
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  {name}
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Fertig</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

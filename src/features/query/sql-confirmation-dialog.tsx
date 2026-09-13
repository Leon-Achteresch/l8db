import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { answerSqlConfirmation, useSqlConfirmation } from "@/lib/sql-confirmation";

export function SqlConfirmationDialog() {
  const request = useSqlConfirmation((state) => state.requests[0]);
  const finish = (accepted: boolean) => {
    if (request) answerSqlConfirmation(request.id, accepted);
  };
  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && finish(false)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Destruktive Abfrage ausführen?</DialogTitle>
          <DialogDescription>
            {request?.connection} · {request?.database ?? "Standard-Datenbank"}. Diese Anweisungen
            können Daten dauerhaft löschen.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-3 overflow-auto">
          {request?.statements.map((statement, index) => (
            <div key={index} className="space-y-1 rounded-md border border-destructive/30 p-3">
              <p className="text-sm font-medium text-destructive">{statement.reason}</p>
              <pre className="whitespace-pre-wrap break-all font-mono text-xs">{statement.sql}</pre>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => finish(false)}>
            Abbrechen
          </Button>
          <Button variant="destructive" onClick={() => finish(true)}>
            Abfrage ausführen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

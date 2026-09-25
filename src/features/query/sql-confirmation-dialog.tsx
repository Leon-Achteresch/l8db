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
import { answerSqlConfirmation, useSqlConfirmation } from "@/lib/sql-confirmation";

export function SqlConfirmationDialog() {
  const request = useSqlConfirmation((state) => state.requests[0]);
  const [typed, setTyped] = useState("");
  const [typedFor, setTypedFor] = useState<string | null>(null);
  if ((request?.id ?? null) !== typedFor) {
    setTypedFor(request?.id ?? null);
    setTyped("");
  }
  const required = request?.confirmTexts ?? [];
  const matches = required.length === 0 || required.includes(typed.trim());
  const finish = (accepted: boolean) => {
    if (request) answerSqlConfirmation(request.id, accepted && matches);
  };
  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && finish(false)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{request?.title ?? "Destruktive Abfrage ausführen?"}</DialogTitle>
          <DialogDescription>
            {request?.connection} · {request?.database ?? "Standard-Datenbank"}.{" "}
            {request?.description ?? "Diese Anweisungen verändern oder löschen Daten."}
          </DialogDescription>
        </DialogHeader>
        {required.length > 0 && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            Produktionsumgebung
          </div>
        )}
        <div className="max-h-80 space-y-3 overflow-auto">
          {request?.statements.map((statement, index) => (
            <div key={index} className="space-y-1 rounded-md border border-destructive/30 p-3">
              <p className="text-sm font-medium text-destructive">{statement.reason}</p>
              <pre className="whitespace-pre-wrap break-all font-mono text-xs">{statement.sql}</pre>
            </div>
          ))}
        </div>
        {required.length > 0 && (
          <div className="grid gap-1.5 text-sm">
            <label htmlFor="sql-confirmation-text">
              Zum Bestätigen <strong className="font-mono">{required[0]}</strong>
              {required.length > 1 && (
                <>
                  {" "}
                  oder <strong className="font-mono">{required[1]}</strong>
                </>
              )}{" "}
              eingeben
            </label>
            <Input
              id="sql-confirmation-text"
              autoFocus
              value={typed}
              aria-label="Bestätigungstext"
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && matches) finish(true);
              }}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => finish(false)}>
            Abbrechen
          </Button>
          <Button variant="destructive" disabled={!matches} onClick={() => finish(true)}>
            {request?.confirmLabel ?? "Abfrage ausführen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { Label } from "@/components/ui/label";
import { ProcedureRunResult } from "./procedure-run-result";
import { useProcedureRun } from "./use-procedure-run";

interface ProcedureRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: string;
  name: string;
  identityArgs: string;
}

export function ProcedureRunDialog({
  open,
  onOpenChange,
  schema,
  name,
  identityArgs,
}: ProcedureRunDialogProps) {
  const { connection, values, setValue, inputs, statement, state, pending, handleRun } =
    useProcedureRun(open, schema, name, identityArgs);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`flex max-h-[85vh] flex-col ${state.status === "success" && state.result.columns.length ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
      >
        <DialogHeader>
          <DialogTitle>
            {schema}.{name} ausführen
          </DialogTitle>
          <DialogDescription>
            {inputs.length === 0
              ? "Diese Prozedur erwartet keine Eingabeparameter."
              : "Parameter typgerecht ausfüllen. Leere Felder werden als NULL übergeben."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          {inputs.map((param, index) => {
            const key = param.name || `p${index + 1}`;
            return (
              <div key={key} className="flex flex-col gap-1.5">
                <Label htmlFor={`param-${key}`}>
                  {key}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {param.mode} {param.type}
                  </span>
                </Label>
                <Input
                  id={`param-${key}`}
                  value={values[key] ?? ""}
                  placeholder={param.type}
                  disabled={pending}
                  onChange={(event) => setValue(key, event.target.value)}
                />
              </div>
            );
          })}
          <code className="rounded bg-muted px-2 py-1.5 font-mono text-xs break-all select-text">
            {statement}
          </code>
          {state.status === "success" && connection ? (
            <ProcedureRunResult key={state.runId} result={state.result} kind={connection.kind} />
          ) : null}
          {pending ? (
            <p role="status" className="text-xs text-muted-foreground">
              {state.status === "loading" ? "Wird ausgeführt…" : "Vorheriger Aufruf läuft…"}
            </p>
          ) : null}
          {state.status === "error" ? (
            <pre
              role="alert"
              className="whitespace-pre-wrap break-all font-mono text-xs text-destructive select-text"
            >
              {state.message}
            </pre>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Schließen
          </Button>
          <Button onClick={handleRun} disabled={pending || !connection}>
            Ausführen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

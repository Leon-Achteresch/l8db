import { useCallback, useMemo, useState } from "react";

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
import { useActiveConnection } from "@/lib/connections";
import { executeQuery } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { buildProcedureCall, parseProcedureParams } from "@/lib/procedure-params";
import { effectiveConnectionString } from "@/lib/ssh";

interface ProcedureRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: string;
  name: string;
  identityArgs: string;
}

type RunState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; time: number; rows: number }
  | { status: "error"; message: string };

export function ProcedureRunDialog({
  open,
  onOpenChange,
  schema,
  name,
  identityArgs,
}: ProcedureRunDialogProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, setState] = useState<RunState>({ status: "idle" });

  const params = useMemo(() => parseProcedureParams(identityArgs), [identityArgs]);
  const inputs = params.filter((param) => param.mode !== "OUT");

  const statement = useMemo(() => {
    if (!connection) return "";
    return buildProcedureCall(
      connection.kind === "oracle" ? "oracle" : "postgres",
      schema,
      name,
      params,
      values,
    );
  }, [connection, schema, name, params, values]);

  const handleRun = useCallback(async () => {
    if (!connection) return;
    setState({ status: "loading" });
    try {
      const result = await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        statement,
        database ?? undefined,
      );
      setState({
        status: "success",
        time: result.execution_time_ms,
        rows: result.rows.length,
      });
    } catch (e) {
      setState({ status: "error", message: String(e) });
    }
  }, [connection, database, statement]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
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
        <div className="flex flex-col gap-3">
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
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [key]: event.target.value }))
                  }
                />
              </div>
            );
          })}
          <code className="rounded bg-muted px-2 py-1.5 font-mono text-xs break-all select-text">
            {statement}
          </code>
          {state.status === "success" ? (
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
              Ausgeführt in {state.time} ms · {state.rows} Ergebniszeilen
            </p>
          ) : null}
          {state.status === "error" ? (
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-destructive select-text">
              {state.message}
            </pre>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Schließen
          </Button>
          <Button onClick={handleRun} disabled={state.status === "loading" || !connection}>
            Ausführen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

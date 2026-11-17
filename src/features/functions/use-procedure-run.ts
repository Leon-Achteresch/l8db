import { useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useActiveConnection } from "@/lib/connections";
import { type DatabaseKind, executeQuery, type QueryResult } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { buildProcedureCall, parseProcedureParams } from "@/lib/procedure-params";
import { createProcedureRun, IDLE_PROCEDURE_RUN } from "@/lib/procedure-run";
import { effectiveConnectionString } from "@/lib/ssh";

export type ProcedureExecution = {
  kind: DatabaseKind;
  execute: (statement: string) => Promise<QueryResult>;
};

export function useProcedureRun(
  open: boolean,
  schema: string,
  name: string,
  identityArgs: string,
  execution?: ProcedureExecution,
) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const kind = execution?.kind ?? connection?.kind;
  const context = useMemo(
    () => ({ connection, database, schema, name, identityArgs, execution }),
    [connection, database, schema, name, identityArgs, execution],
  );
  const [input, setInput] = useState<{ context: object; values: Record<string, string> }>({
    context,
    values: {},
  });
  const values = useMemo(() => (input.context === context ? input.values : {}), [input, context]);
  const params = useMemo(() => parseProcedureParams(identityArgs), [identityArgs]);
  const inputs = useMemo(() => params.filter((param) => param.mode !== "OUT"), [params]);
  const statement = useMemo(
    () =>
      kind
        ? buildProcedureCall(
            kind === "oracle" ? "oracle" : "postgres",
            schema,
            name,
            params,
            values,
          )
        : "",
    [kind, schema, name, params, values],
  );
  const scope = useMemo(() => (open ? { context, statement } : null), [open, context, statement]);
  const [run] = useState(createProcedureRun);
  const snapshot = useSyncExternalStore(run.subscribe, run.getSnapshot, run.getSnapshot);

  useLayoutEffect(() => {
    run.setScope(scope);
    return () => run.setScope(null);
  }, [run, scope]);

  const setValue = useCallback(
    (key: string, value: string) => {
      if (run.getSnapshot().pending) return;
      setInput((previous) => ({
        context,
        values: { ...(previous.context === context ? previous.values : {}), [key]: value },
      }));
    },
    [run, context],
  );

  const handleRun = useCallback(async () => {
    if (!scope) return;
    if (execution) {
      await run.run(scope, () => execution.execute(statement));
      return;
    }
    if (!connection) return;
    await run.run(scope, () =>
      executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        statement,
        database ?? undefined,
      ),
    );
  }, [connection, database, statement, run, scope, execution]);

  return {
    connection: execution ?? connection,
    inputs,
    values,
    setValue,
    statement,
    state: snapshot.scope === scope ? snapshot.state : IDLE_PROCEDURE_RUN,
    pending: snapshot.pending,
    handleRun,
  };
}

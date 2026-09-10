import { getRouteApi } from "@tanstack/react-router";
import { BugIcon, HammerIcon, LoaderIcon, PlayIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SqlEditorPane } from "@/features/functions/function-view";
import { ProcedureRunDialog } from "@/features/functions/procedure-run-dialog";
import { useCompileObject } from "@/features/functions/use-compile-object";
import { useActiveConnection } from "@/lib/connections";
import { type DebugSessionInfo, startDebugSession } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { useFunctionDefinitionQuery, useProceduresQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";

const routeApi = getRouteApi("/_app/_workspace/procedures/$schema/$name");

export function ProcedureView() {
  const { schema, name } = routeApi.useParams();
  const { oid, line } = routeApi.useSearch();
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const capabilities = useActiveCapabilities();
  const openProcedureTab = useTableTabs((state) => state.openProcedureTab);
  const { data, isLoading, isError, error } = useFunctionDefinitionQuery(oid ?? "");
  const procedures = useProceduresQuery();
  const { compile, state: compileState } = useCompileObject();

  const [runOpen, setRunOpen] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugSessionInfo | null>(null);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);

  useEffect(() => {
    if (oid) {
      openProcedureTab({ schema, name, oid });
    }
  }, [schema, name, oid, openProcedureTab]);

  const current = procedures.data?.find((item) => item.oid === oid);
  const identityArgs = current?.identity_args ?? "";

  const handleCompile = useCallback(() => {
    if (!oid) return;
    void compile(oid, "procedure", `${schema}.${name}`);
  }, [compile, oid, schema, name]);

  const handleDebug = useCallback(async () => {
    if (!connection || !oid) return;
    setDebugLoading(true);
    setDebugError(null);
    setDebugInfo(null);
    try {
      const info = await startDebugSession(
        connection.kind,
        effectiveConnectionString(connection),
        oid,
        "procedure",
        database ?? undefined,
      );
      setDebugInfo(info);
    } catch (e) {
      setDebugError(String(e));
    } finally {
      setDebugLoading(false);
    }
  }, [connection, database, oid]);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-hidden bg-background p-4 space-y-3 select-none">
        <Skeleton className="h-6 w-64 bg-muted/50" />
        <div className="space-y-2 mt-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-5 bg-muted/30" style={{ width: `${55 + i * 3}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <div className="flex flex-col items-center gap-3 max-w-md text-center p-6 rounded-lg border border-destructive/20 bg-destructive/5 shadow-xs">
          <TriangleAlertIcon className="size-8 text-destructive" />
          <h3 className="text-sm font-semibold text-destructive">Fehler beim Laden der Prozedur</h3>
          <p className="text-xs text-muted-foreground font-mono p-2.5 rounded border border-destructive/10 break-all select-text">
            {String(error)}
          </p>
        </div>
      </div>
    );
  }

  const compileResult = compileState.status === "done" ? compileState.result : null;
  const revealLine = compileResult?.line ?? line;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground truncate">
          {schema}.{name}({identityArgs})
        </span>
        {compileResult ? (
          <Badge variant={compileResult.status === "VALID" ? "outline" : "destructive"}>
            {compileResult.status}
          </Badge>
        ) : null}
        <span className="flex-1" />
        <Button variant="outline" size="xs" onClick={() => setRunOpen(true)}>
          <PlayIcon data-icon="inline-start" />
          Ausführen
        </Button>
        {capabilities.compile_objects ? (
          <Button
            variant="outline"
            size="xs"
            onClick={handleCompile}
            disabled={compileState.status === "loading" || !oid}
          >
            {compileState.status === "loading" ? (
              <LoaderIcon data-icon="inline-start" className="animate-spin" />
            ) : (
              <HammerIcon data-icon="inline-start" />
            )}
            Kompilieren
          </Button>
        ) : null}
        {capabilities.debugger ? (
          <Button variant="outline" size="xs" onClick={handleDebug} disabled={debugLoading || !oid}>
            {debugLoading ? (
              <LoaderIcon data-icon="inline-start" className="animate-spin" />
            ) : (
              <BugIcon data-icon="inline-start" />
            )}
            Debug-Sitzung starten
          </Button>
        ) : null}
      </div>

      <SqlEditorPane value={data ?? ""} readOnly revealLine={revealLine} />

      {compileState.status === "error" ? (
        <div className="flex items-start gap-2 border-t bg-destructive/5 px-4 py-2.5">
          <pre className="flex-1 whitespace-pre-wrap break-all text-xs font-mono text-destructive select-text">
            {compileState.message}
          </pre>
        </div>
      ) : null}
      {compileResult && compileResult.status !== "VALID" ? (
        <div className="flex flex-col gap-1 border-t bg-destructive/5 px-4 py-2.5">
          <span className="text-xs font-semibold text-destructive">
            Kompilierfehler
            {compileResult.line ? ` in Zeile ${compileResult.line}` : ""}
            {compileResult.position ? `, Position ${compileResult.position}` : ""}
          </span>
          <pre className="whitespace-pre-wrap break-all text-xs font-mono text-destructive select-text">
            {compileResult.message}
          </pre>
        </div>
      ) : null}
      {debugError ? (
        <div className="border-t bg-destructive/5 px-4 py-2.5 text-xs font-mono text-destructive select-text">
          {debugError}
        </div>
      ) : null}
      {debugInfo ? (
        <div className="border-t bg-amber-500/5 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-300 select-text">
          {debugInfo.message}
        </div>
      ) : null}

      <ProcedureRunDialog
        open={runOpen}
        onOpenChange={setRunOpen}
        schema={schema}
        name={name}
        identityArgs={identityArgs}
      />
    </div>
  );
}

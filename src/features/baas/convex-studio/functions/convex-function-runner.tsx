import { useMutation } from "@tanstack/react-query";
import { Play, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { JsonEditor } from "@/features/table/json-editor/json-editor";
import {
  type ConvexStudioTarget,
  type ConvexUdfType,
  convexStudioFunctionsRun,
} from "@/lib/db/convex-studio-functions";
import { ConvexFunctionHistory } from "./convex-function-history";
import { useConvexFunctionHistory } from "./convex-function-history-store";

const LEVEL_CLASS: Record<string, string> = {
  ERROR: "text-destructive",
  WARN: "text-amber-600",
  INFO: "text-sky-600",
  DEBUG: "text-muted-foreground",
};

const numbered = (lines: string[]) => lines.map((text, position) => ({ text, position }));

function parseArgs(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text.trim() || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Argumente müssen ein JSON-Objekt sein.");
  }
  return value as Record<string, unknown>;
}

export function ConvexFunctionRunner({
  target,
  deploymentKey,
  identifier,
  udfType,
  componentPath,
  initialArgs,
}: {
  target: ConvexStudioTarget;
  deploymentKey: string;
  identifier: string;
  udfType: ConvexUdfType;
  componentPath: string | null;
  initialArgs: string;
}) {
  const [args, setArgs] = useState(initialArgs);
  const [editorKey, setEditorKey] = useState(0);
  const addRun = useConvexFunctionHistory((state) => state.add);
  const run = useMutation({
    mutationFn: async () => {
      const result = await convexStudioFunctionsRun(
        target,
        identifier,
        parseArgs(args),
        componentPath,
      );
      addRun(deploymentKey, {
        identifier,
        componentPath,
        args,
        success: result.success,
        durationMs: result.durationMs,
        preview: result.success
          ? (JSON.stringify(result.value) ?? "null")
          : (result.errorMessage ?? "Fehler"),
      });
      return result;
    },
  });
  const result = run.data;
  const replaceArgs = (text: string) => {
    setArgs(text);
    setEditorKey((key) => key + 1);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Läuft mit Admin-Rechten
          {udfType !== "query" && ", Änderungen wirken sofort im Deployment"}.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => replaceArgs(initialArgs)}>
            <RotateCcw className="size-3.5" />
            Vorlage
          </Button>
          <Button size="sm" disabled={run.isPending} onClick={() => run.mutate()}>
            <Play className="size-3.5" />
            {run.isPending ? "Läuft…" : "Ausführen"}
          </Button>
        </div>
      </div>
      <JsonEditor
        key={editorKey}
        text={args}
        onChange={setArgs}
        readOnly={false}
        columnName="Argumente"
        className="h-56"
      />
      {run.isError && (
        <p role="alert" className="text-xs text-destructive">
          {run.error instanceof Error ? run.error.message : String(run.error)}
        </p>
      )}
      {result && (
        <div className="space-y-2 rounded-xl border p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={result.success ? "secondary" : "destructive"}>
              {result.success ? "Erfolgreich" : "Fehler"}
            </Badge>
            <span className="text-muted-foreground">{result.durationMs} ms</span>
          </div>
          {result.success ? (
            <JsonEditor
              key={`${result.durationMs}:${run.submittedAt}`}
              text={JSON.stringify(result.value ?? null, null, 2)}
              readOnly
              columnName="Ergebnis"
              className="h-72"
            />
          ) : (
            <div className="space-y-2">
              <pre className="max-h-72 overflow-auto rounded-lg bg-destructive/10 p-3 font-mono text-xs whitespace-pre-wrap text-destructive">
                {result.errorMessage}
              </pre>
              {result.errorData != null && (
                <pre className="max-h-48 overflow-auto rounded-lg bg-muted/30 p-3 font-mono text-xs">
                  {JSON.stringify(result.errorData, null, 2)}
                </pre>
              )}
            </div>
          )}
          <div className="space-y-1">
            <p className="text-xs font-medium">
              Logs ({result.logLines.length}
              {result.logLinesTruncated && ", gekürzt auf 500"})
            </p>
            {result.logLines.length === 0 ? (
              <p className="text-xs text-muted-foreground">Keine Logzeilen.</p>
            ) : (
              <pre className="max-h-48 overflow-auto rounded-lg bg-muted/30 p-3 font-mono text-[11px] whitespace-pre-wrap">
                {numbered(result.logLines).map((line) => (
                  <span
                    key={line.position}
                    className={`block ${LEVEL_CLASS[/^\[(\w+)\]/.exec(line.text)?.[1] ?? ""] ?? ""}`}
                  >
                    {line.text}
                  </span>
                ))}
              </pre>
            )}
          </div>
        </div>
      )}
      <ConvexFunctionHistory
        deploymentKey={deploymentKey}
        identifier={identifier}
        componentPath={componentPath}
        onPick={replaceArgs}
      />
    </div>
  );
}

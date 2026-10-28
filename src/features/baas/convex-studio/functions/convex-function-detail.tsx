import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type ConvexStudioFunction,
  type ConvexStudioModule,
  type ConvexStudioTarget,
  convexStudioFunctionsDetail,
} from "@/lib/db/convex-studio-functions";
import { ConvexFunctionRunner } from "./convex-function-runner";
import { ConvexFunctionStats } from "./convex-function-stats";
import { argsTemplate, describeValidator } from "./convex-validator";

const TYPE_NAME: Record<string, string> = {
  query: "Query",
  mutation: "Mutation",
  action: "Aktion",
  httpAction: "HTTP-Aktion",
};

export function ConvexFunctionDetail({
  target,
  deploymentKey,
  module,
  fn,
}: {
  target: ConvexStudioTarget;
  deploymentKey: string;
  module: ConvexStudioModule;
  fn: ConvexStudioFunction;
}) {
  const detail = useQuery({
    queryKey: [
      "convex",
      target.id,
      "functions",
      deploymentKey,
      "function",
      module.componentId,
      fn.identifier,
    ],
    queryFn: () => convexStudioFunctionsDetail(target, fn.identifier, module.componentId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const args = fn.args ?? detail.data?.args ?? null;
  const runnable = fn.udfType !== "httpAction";
  const argsReady = fn.args != null || !detail.isLoading;

  return (
    <div className="min-w-0 space-y-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-mono text-sm font-semibold break-all">
            {module.componentPath ? `${module.componentPath}/` : ""}
            {fn.identifier}
          </h3>
          <Badge variant="secondary">{TYPE_NAME[fn.udfType] ?? fn.udfType}</Badge>
          <Badge variant={fn.visibility === "internal" ? "outline" : "secondary"}>
            {fn.visibility === "internal" ? "Intern" : "Öffentlich"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {module.path}
          {fn.lineno != null && `, Zeile ${fn.lineno}`}
        </p>
      </div>
      <Tabs defaultValue={runnable ? "run" : "validators"}>
        <TabsList>
          {runnable && <TabsTrigger value="run">Ausführen</TabsTrigger>}
          <TabsTrigger value="validators">Validatoren</TabsTrigger>
          <TabsTrigger value="source">Quelltext</TabsTrigger>
          <TabsTrigger value="stats">Statistik</TabsTrigger>
        </TabsList>
        {runnable && (
          <TabsContent value="run">
            {argsReady ? (
              <ConvexFunctionRunner
                target={target}
                deploymentKey={deploymentKey}
                identifier={fn.identifier}
                udfType={fn.udfType}
                componentPath={module.componentPath || null}
                initialArgs={argsTemplate(args)}
              />
            ) : (
              <p className="text-xs text-muted-foreground">Argument-Validator wird geladen…</p>
            )}
          </TabsContent>
        )}
        <TabsContent value="validators" className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-medium">Argumente</p>
            <pre className="overflow-auto rounded-lg bg-muted/30 p-3 font-mono text-xs">
              {args ? describeValidator(args) : "Kein Argument-Validator definiert."}
            </pre>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">Rückgabe</p>
            <pre className="overflow-auto rounded-lg bg-muted/30 p-3 font-mono text-xs">
              {fn.returns ? describeValidator(fn.returns) : "Kein Rückgabe-Validator definiert."}
            </pre>
          </div>
          {args != null && (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Validator als JSON
              </summary>
              <pre className="mt-1 max-h-80 overflow-auto rounded-lg bg-muted/30 p-3 font-mono text-[11px]">
                {JSON.stringify({ args, returns: fn.returns }, null, 2)}
              </pre>
            </details>
          )}
        </TabsContent>
        <TabsContent value="source">
          {detail.isLoading && (
            <p className="text-xs text-muted-foreground">Quelltext wird geladen…</p>
          )}
          {detail.isError && (
            <p role="alert" className="text-xs text-destructive">
              {String(detail.error)}
            </p>
          )}
          {detail.data && !detail.data.source && (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Dieses Deployment stellt den Quelltext nicht über die Admin-API bereit.
            </p>
          )}
          {detail.data?.source && (
            <div className="space-y-1">
              {detail.data.sourceTruncated && (
                <p className="text-xs text-amber-600">Quelltext auf 2 MB gekürzt.</p>
              )}
              <pre className="max-h-[60vh] overflow-auto rounded-xl border bg-muted/30 p-3 font-mono text-xs">
                {detail.data.source}
              </pre>
            </div>
          )}
        </TabsContent>
        <TabsContent value="stats">
          <ConvexFunctionStats
            target={target}
            deploymentKey={deploymentKey}
            identifier={fn.identifier}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

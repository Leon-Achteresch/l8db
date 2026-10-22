import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { convexStudioFunctionsList } from "@/lib/db/convex-studio-functions";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { ConvexStudioSectionProps } from "../convex-studio-sections";
import { ConvexComponentsList } from "./convex-components-list";
import { ConvexFunctionDetail } from "./convex-function-detail";
import { ConvexFunctionTree } from "./convex-function-tree";
import { ConvexHttpTester } from "./convex-http-tester";

export function ConvexFunctionsSection({ deployment }: ConvexStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.convex.studio.functions");
  const target = useMemo(
    () => ({
      id: deployment.profileId,
      projectId: deployment.projectId,
      deploymentName: deployment.deploymentName,
    }),
    [deployment.profileId, deployment.projectId, deployment.deploymentName],
  );
  const deploymentKey = `${target.id}:${target.projectId}:${target.deploymentName}`;
  const catalog = useQuery({
    queryKey: ["convex", target.id, "functions", deploymentKey, "functions"],
    queryFn: () => convexStudioFunctionsList(target),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const modules = catalog.data?.modules ?? [];
  const current = modules
    .flatMap((module) => module.functions.map((fn) => ({ module, fn })))
    .find(({ module, fn }) => `${module.componentPath}|${fn.identifier}` === selected);
  const components = catalog.data?.components ?? [];
  const hasComponents = components.some((component) => component.path !== "");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 ref={feature.ref} className="flex items-center gap-2 text-lg font-semibold">
            Funktionen {feature.isNew && <NewBadge />}
          </h2>
          <p className="text-xs text-muted-foreground">
            Queries, Mutationen, Aktionen und HTTP-Aktionen ansehen, als Admin ausführen und
            auswerten.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={catalog.isFetching}
          onClick={() => void catalog.refetch()}
        >
          <RefreshCw className="size-3.5" />
          Neu laden
        </Button>
      </div>
      {catalog.isError && (
        <p role="alert" className="text-xs text-destructive">
          {String(catalog.error)}
        </p>
      )}
      {catalog.data?.truncated && (
        <p className="text-xs text-amber-600">Liste auf 5000 Funktionen begrenzt.</p>
      )}
      <Tabs defaultValue="functions">
        <TabsList>
          <TabsTrigger value="functions">Funktionen</TabsTrigger>
          <TabsTrigger value="http">
            HTTP-Aktionen
            {catalog.data && ` (${catalog.data.httpRoutes.length})`}
          </TabsTrigger>
          {hasComponents && <TabsTrigger value="components">Komponenten</TabsTrigger>}
        </TabsList>
        <TabsContent value="functions">
          <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <ConvexFunctionTree
              modules={modules}
              loading={catalog.isLoading}
              selected={selected}
              onSelect={setSelected}
            />
            {current ? (
              <ConvexFunctionDetail
                key={selected}
                target={target}
                deploymentKey={deploymentKey}
                module={current.module}
                fn={current.fn}
              />
            ) : (
              <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
                Funktion links auswählen.
              </p>
            )}
          </div>
        </TabsContent>
        <TabsContent value="http">
          <ConvexHttpTester
            target={target}
            routes={catalog.data?.httpRoutes ?? []}
            siteUrl={catalog.data?.siteUrl ?? null}
          />
        </TabsContent>
        {hasComponents && (
          <TabsContent value="components">
            <ConvexComponentsList components={components} modules={modules} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

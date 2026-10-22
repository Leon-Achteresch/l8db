import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabaseHealth } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { RealtimeInspector } from "./realtime-inspector";
import { SupabaseRealtimePublication } from "./supabase-realtime-publication";

const NEEDS_SQL =
  "Die Publikation benötigt SQL-Zugriff (Secret Key selbst gehostet oder Supabase-Zugangstoken).";

export function SupabaseRealtimeSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.realtime");
  const health = useQuery({
    queryKey: ["supabase", project.reference, "health"],
    queryFn: () => supabaseHealth(project.reference),
    staleTime: 60_000,
  });
  const realtime = health.data?.find((service) => service.name === "realtime");
  const fallback = health.isError
    ? "Status nicht verfügbar"
    : health.isLoading
      ? "Status wird geprüft…"
      : "Kein Status";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 ref={feature.ref} className="flex items-center gap-2 text-lg font-semibold">
            Realtime {feature.isNew && <NewBadge />}
          </h2>
          <p className="text-xs text-muted-foreground">
            Kanäle abonnieren, Broadcasts senden, Presence beobachten und Tabellen für
            Postgres-Änderungen freigeben. Die Verbindung läuft in l8db, der Key verlässt die App
            nicht.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {realtime ? (
            <Badge variant={realtime.healthy ? "secondary" : "destructive"}>
              Realtime: {realtime.healthy ? "gesund" : realtime.status}
            </Badge>
          ) : (
            <span className="text-muted-foreground">{fallback}</span>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Status neu laden"
            disabled={health.isFetching}
            onClick={() => void health.refetch()}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>
      <Tabs defaultValue="inspector">
        <TabsList>
          <TabsTrigger value="inspector">Inspektor</TabsTrigger>
          <TabsTrigger
            value="publication"
            disabled={!capabilities.sql}
            title={capabilities.sql ? undefined : NEEDS_SQL}
          >
            Publikation
          </TabsTrigger>
        </TabsList>
        <TabsContent value="inspector">
          <RealtimeInspector reference={project.reference} />
        </TabsContent>
        {capabilities.sql && (
          <TabsContent value="publication">
            <SupabaseRealtimePublication reference={project.reference} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

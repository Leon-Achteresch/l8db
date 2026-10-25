import { useQuery } from "@tanstack/react-query";
import { Radar, RefreshCw, Share2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { supabaseHealth } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { SupabaseSectionHeader } from "../supabase-section-header";
import { SupabaseSectionTitle } from "../supabase-section-title";
import { SupabaseSidebarTabs } from "../supabase-sidebar-tabs";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { RealtimeInspector } from "./realtime-inspector";
import { SupabaseRealtimePublication } from "./supabase-realtime-publication";

const NEEDS_SQL =
  "Die Publikation benötigt SQL-Zugriff (Secret Key selbst gehostet oder Supabase-Zugangstoken).";

export function SupabaseRealtimeSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.realtime");
  const [tab, setTab] = useState("inspector");
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
    <div className="space-y-5">
      <SupabaseSectionHeader
        title={
          <SupabaseSectionTitle
            section="Realtime"
            part={tab === "inspector" ? "Inspektor" : "Publikation"}
          />
        }
        titleRef={feature.ref}
        isNew={feature.isNew}
        description="Kanäle abonnieren, Broadcasts senden, Presence beobachten und Tabellen für Postgres-Änderungen freigeben. Die Verbindung läuft in l8db, der Key verlässt die App nicht."
        actions={
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
        }
      />
      <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="flex-col">
        <SupabaseSidebarTabs
          label="Realtime"
          items={[
            { value: "inspector", label: "Inspektor", icon: Radar },
            {
              value: "publication",
              label: "Publikation",
              icon: Share2,
              disabledReason: capabilities.sql ? null : NEEDS_SQL,
            },
          ]}
        />
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

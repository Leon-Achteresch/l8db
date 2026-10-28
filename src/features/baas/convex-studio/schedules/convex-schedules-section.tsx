import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { ConvexStudioSectionProps } from "../convex-studio-sections";
import { ConvexCronJobs } from "./convex-cron-jobs";
import { ConvexScheduledJobs } from "./convex-scheduled-jobs";
import { AUTO_REFRESH_OPTIONS } from "./convex-schedules-format";

export function ConvexSchedulesSection({ deployment }: ConvexStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.convex.studio.schedules");
  const queryClient = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState("0");
  const predicate = ({ queryKey }: { queryKey: readonly unknown[] }) =>
    queryKey[0] === "convex" &&
    queryKey[1] === deployment.profileId &&
    queryKey[2] === deployment.deploymentName &&
    (queryKey[3] === "scheduled-jobs" || queryKey[3] === "cron-jobs");
  const fetching = useIsFetching({ predicate }) > 0;
  const refetchInterval = autoRefresh === "0" ? false : Number(autoRefresh);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 ref={feature.ref} className="flex items-center gap-2 text-lg font-semibold">
            Zeitpläne {feature.isNew && <NewBadge />}
          </h2>
          <p className="text-xs text-muted-foreground">
            Geplante Funktionen und Cron-Jobs von {deployment.title} überwachen, abbrechen und
            ausführen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={autoRefresh} onValueChange={setAutoRefresh}>
            <SelectTrigger
              size="sm"
              className="h-8 w-36 text-xs"
              aria-label="Automatisch aktualisieren"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTO_REFRESH_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-xs">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={fetching}
            onClick={() => queryClient.invalidateQueries({ predicate })}
          >
            <RefreshCw className={fetching ? "size-3.5 animate-spin" : "size-3.5"} /> Aktualisieren
          </Button>
        </div>
      </div>
      <Tabs defaultValue="jobs">
        <TabsList>
          <TabsTrigger value="jobs">Geplante Funktionen</TabsTrigger>
          <TabsTrigger value="crons">Cron-Jobs</TabsTrigger>
        </TabsList>
        <TabsContent value="jobs">
          <ConvexScheduledJobs target={deployment} refetchInterval={refetchInterval} />
        </TabsContent>
        <TabsContent value="crons">
          <ConvexCronJobs target={deployment} refetchInterval={refetchInterval} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

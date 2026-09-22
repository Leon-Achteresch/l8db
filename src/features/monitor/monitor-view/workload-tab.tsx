import { TabsContent } from "@/components/ui/tabs";
import { QueryStatsCard } from "@/features/monitor/monitor-view/query-stats-card";
import type { MonitorViewState } from "@/features/monitor/monitor-view/use-monitor-view";
import { useWorkloadReplay } from "@/features/monitor/monitor-view/use-workload-replay";
import { WorkloadReplayCard } from "@/features/monitor/monitor-view/workload-replay-card";

export function WorkloadTab({ m }: { m: MonitorViewState }) {
  const replay = useWorkloadReplay();
  if (!m.connection) return null;
  return (
    <TabsContent value="workload" className="mt-5 space-y-5">
      <QueryStatsCard
        kind={m.connection.kind}
        supported={m.capabilities.query_stats && m.tab === "workload"}
        replay={replay}
      />
      <WorkloadReplayCard replay={replay} />
    </TabsContent>
  );
}

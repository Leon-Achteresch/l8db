import { TabsContent } from "@/components/ui/tabs";
import { LiveActivityCard } from "./live-activity-card";
import { LiveKpiTiles } from "./live-kpi-tiles";
import { LiveQueryCard } from "./live-query-card";
import { LiveSessionDetails } from "./live-session-details";
import { LiveSessionsCard } from "./live-sessions-card";
import type { LiveMonitorState } from "./use-live-monitor";

export function LiveOverviewTab({ m }: { m: LiveMonitorState }) {
  const session = m.selectedSession;
  return (
    <TabsContent value="live" className="mt-4 space-y-4">
      {m.metricsError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Live-Kennzahlen konnten nicht geladen werden: {m.metricsError}
        </p>
      )}
      <LiveKpiTiles m={m} />
      <div
        className={
          session
            ? "grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]"
            : "grid gap-4"
        }
      >
        <div className="min-w-0 space-y-4">
          <LiveActivityCard m={m} />
          <LiveSessionsCard m={m} />
        </div>
        {session && (
          <div className="min-w-0 space-y-4">
            <LiveSessionDetails m={m} session={session} />
            <LiveQueryCard m={m} session={session} />
          </div>
        )}
      </div>
    </TabsContent>
  );
}

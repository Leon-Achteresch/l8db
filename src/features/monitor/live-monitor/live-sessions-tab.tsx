import { TabsContent } from "@/components/ui/tabs";
import { LiveSessionDetails } from "./live-session-details";
import { LiveSessionsCard } from "./live-sessions-card";
import type { LiveMonitorState } from "./use-live-monitor";

export function LiveSessionsTab({ m }: { m: LiveMonitorState }) {
  const session = m.selectedSession;
  return (
    <TabsContent value="sessions" className="mt-4">
      <div
        className={
          session
            ? "grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]"
            : "grid gap-4"
        }
      >
        <LiveSessionsCard m={m} />
        {session && <LiveSessionDetails m={m} session={session} />}
      </div>
    </TabsContent>
  );
}

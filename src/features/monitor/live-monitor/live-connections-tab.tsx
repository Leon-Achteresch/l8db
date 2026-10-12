import { NetworkIcon, PlugZapIcon, UserIcon, UsersIcon } from "lucide-react";
import { useMemo } from "react";
import { TabsContent } from "@/components/ui/tabs";
import { formatCount } from "@/features/monitor/monitor-view/format";
import type { SessionInfo } from "@/lib/db";
import { LiveActivityCard } from "./live-activity-card";
import { type LiveGroupRow, LiveGroupTable } from "./live-group-table";
import { LiveStatTile } from "./live-stat-tile";
import type { LiveMonitorState } from "./use-live-monitor";

const GROUP_LIMIT = 12;

function groupBy(sessions: SessionInfo[], pick: (session: SessionInfo) => string): LiveGroupRow[] {
  const groups = new Map<string, LiveGroupRow>();
  for (const session of sessions) {
    const key = pick(session) || "(leer)";
    const row = groups.get(key) ?? { key, total: 0, active: 0 };
    row.total++;
    if (session.state === "active") row.active++;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total).slice(0, GROUP_LIMIT);
}

export function LiveConnectionsTab({ m }: { m: LiveMonitorState }) {
  const { sessions } = m;
  const byUser = useMemo(() => groupBy(sessions, (session) => session.user), [sessions]);
  const byApplication = useMemo(
    () => groupBy(sessions, (session) => session.application),
    [sessions],
  );
  const byClient = useMemo(
    () => groupBy(sessions, (session) => session.client_addr ?? "lokal"),
    [sessions],
  );
  const max = m.metrics?.max_connections ?? null;
  const idleInTransaction = sessions.filter((session) =>
    session.state?.startsWith("idle in transaction"),
  ).length;
  return (
    <TabsContent value="connections" className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <LiveStatTile
          label="Verbindungen"
          icon={NetworkIcon}
          value={formatCount(m.connections)}
          suffix={max ? `von ${formatCount(max)}` : null}
          progress={max ? (m.connections / max) * 100 : null}
        />
        <LiveStatTile
          label="Freie Slots"
          icon={PlugZapIcon}
          value={max ? formatCount(Math.max(0, max - m.connections)) : "—"}
        />
        <LiveStatTile label="Benutzer" icon={UserIcon} value={formatCount(byUser.length)} />
        <LiveStatTile
          label="Idle in Transaktion"
          icon={UsersIcon}
          value={formatCount(idleInTransaction)}
          tone={idleInTransaction > 0 ? "warning" : "default"}
          progress={sessions.length ? (idleInTransaction / sessions.length) * 100 : 0}
        />
      </div>
      <LiveActivityCard m={m} title="Verbindungsverlauf" metrics={["connections"]} />
      <div className="grid gap-4 lg:grid-cols-3">
        <LiveGroupTable title="Nach Benutzer" rows={byUser} />
        <LiveGroupTable title="Nach Anwendung" rows={byApplication} />
        <LiveGroupTable title="Nach Client" rows={byClient} />
      </div>
    </TabsContent>
  );
}

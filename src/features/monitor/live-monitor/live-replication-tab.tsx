import { GitForkIcon, ServerIcon, TimerIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { formatBytes, formatCount, formatMs } from "@/features/monitor/monitor-view/format";
import { LiveStatTile } from "./live-stat-tile";
import type { LiveMonitorState } from "./use-live-monitor";

export function LiveReplicationTab({ m }: { m: LiveMonitorState }) {
  const metrics = m.metrics;
  const replicas = metrics?.replication ?? [];
  return (
    <TabsContent value="replication" className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <LiveStatTile
          label="Rolle"
          icon={ServerIcon}
          value={metrics ? (metrics.in_recovery ? "Standby" : "Primär") : "—"}
        />
        <LiveStatTile
          label={metrics?.in_recovery ? "Replikationsquellen" : "Replikate"}
          icon={GitForkIcon}
          value={formatCount(metrics ? replicas.length : null)}
        />
        <LiveStatTile
          label="Replay-Verzögerung"
          icon={TimerIcon}
          value={formatMs(metrics?.replay_delay_ms ?? null)}
          tone={(metrics?.replay_delay_ms ?? 0) > 10_000 ? "warning" : "default"}
        />
      </div>
      <Card size="sm" className="gap-0 py-0">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">Replikationsstatus</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!m.live ? (
            <p className="p-8 text-center text-xs text-muted-foreground">
              Für diese Datenbank sind keine Replikationsdaten verfügbar.
            </p>
          ) : replicas.length === 0 ? (
            <p className="p-8 text-center text-xs text-muted-foreground">
              Keine aktive Replikation gefunden.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Client</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Sync</th>
                  <th className="px-3 py-2 text-right font-medium">Write-Lag</th>
                  <th className="px-3 py-2 text-right font-medium">Flush-Lag</th>
                  <th className="px-3 py-2 text-right font-medium">Replay-Lag</th>
                  <th className="px-3 py-2 text-right font-medium">Rückstand</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {replicas.map((replica) => (
                  <tr key={`${replica.name}-${replica.client_addr ?? ""}`}>
                    <td className="px-3 py-2 font-mono">{replica.name || "—"}</td>
                    <td className="px-3 py-2 font-mono">{replica.client_addr ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                        {replica.state || "—"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{replica.sync_state ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMs(replica.write_lag_ms)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMs(replica.flush_lag_ms)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMs(replica.replay_lag_ms)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {replica.lag_bytes == null ? "—" : formatBytes(replica.lag_bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}

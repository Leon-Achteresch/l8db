import { DownloadIcon, HardDriveIcon, ZapIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { formatCount, formatPercent } from "@/features/monitor/monitor-view/format";
import { LiveActivityCard } from "./live-activity-card";
import { LiveStatTile } from "./live-stat-tile";
import type { LiveMonitorState } from "./use-live-monitor";

function ratio(hit: number, read: number): number | null {
  return hit + read > 0 ? (hit / (hit + read)) * 100 : null;
}

export function LiveIoTab({ m }: { m: LiveMonitorState }) {
  const { latest, tableIo } = m;
  const liveRatio = latest ? ratio(latest.blocksHit, latest.blocksRead) : null;
  return (
    <TabsContent value="io" className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <LiveStatTile
          label="Disk-Lesen"
          icon={DownloadIcon}
          value={formatCount(latest?.blocksRead ?? null, 1)}
          suffix="Blöcke/s"
        />
        <LiveStatTile
          label="Cache-Treffer"
          icon={ZapIcon}
          value={formatCount(latest?.blocksHit ?? null)}
          suffix="Blöcke/s"
        />
        <LiveStatTile
          label="Trefferquote aktuell"
          icon={HardDriveIcon}
          value={formatPercent(liveRatio, 1)}
          progress={liveRatio}
        />
        <LiveStatTile
          label="Zeilen geschrieben"
          icon={HardDriveIcon}
          value={formatCount(latest?.rowsWritten ?? null, 1)}
          suffix="Zeilen/s"
        />
      </div>
      <LiveActivityCard m={m} title="I/O-Verlauf" metrics={["blocks", "rows"]} />
      <Card size="sm" className="gap-0 py-0">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">Tabellen mit dem meisten Disk-I/O</CardTitle>
          <CardDescription>
            Kumuliert seit dem letzten Statistik-Reset, alle 30 s aktualisiert.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {tableIo.length === 0 ? (
            <p className="p-8 text-center text-xs text-muted-foreground">
              Keine I/O-Statistiken je Tabelle verfügbar.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Tabelle</th>
                  <th className="px-3 py-2 text-right font-medium">Heap gelesen</th>
                  <th className="px-3 py-2 text-right font-medium">Heap Cache</th>
                  <th className="px-3 py-2 text-right font-medium">Index gelesen</th>
                  <th className="px-3 py-2 text-right font-medium">Index Cache</th>
                  <th className="px-3 py-2 text-right font-medium">Trefferquote</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {tableIo.map((row) => (
                  <tr key={row.name} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono">{row.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCount(row.heap_read)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCount(row.heap_hit)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCount(row.idx_read)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCount(row.idx_hit)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPercent(
                        ratio(row.heap_hit + row.idx_hit, row.heap_read + row.idx_read),
                        1,
                      )}
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

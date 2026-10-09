import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount } from "@/features/monitor/monitor-view/format";

export interface LiveGroupRow {
  key: string;
  total: number;
  active: number;
}

export function LiveGroupTable({ title, rows }: { title: string; rows: LiveGroupRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.total));
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Keine Verbindungen.</p>
        ) : (
          rows.map((row) => (
            <div key={row.key} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-mono" title={row.key}>
                  {row.key}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatCount(row.active)} aktiv · {formatCount(row.total)}
                </span>
              </div>
              <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${(row.active / max) * 100}%` }}
                />
                <div
                  className="h-full bg-foreground/30"
                  style={{ width: `${((row.total - row.active) / max) * 100}%` }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

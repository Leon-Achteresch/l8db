import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  supabaseStudioObservabilityUsage,
  type UsageInterval,
} from "@/lib/db/supabase-studio-observability";
import { formatLogTimestamp, formatNumber, type LogsTabProps, logsQueryKey } from "./logs-format";
import { LogsListBlock } from "./logs-list-block";
import { LogsQueryState } from "./logs-query-state";

const INTERVALS: { id: UsageInterval; label: string }[] = [
  { id: "1hr", label: "Letzte Stunde" },
  { id: "1day", label: "Letzter Tag" },
  { id: "7day", label: "Letzte 7 Tage" },
];

const COLUMNS = [
  ["total_rest_requests", "REST"],
  ["total_auth_requests", "Auth"],
  ["total_storage_requests", "Storage"],
  ["total_realtime_requests", "Realtime"],
] as const;

export function LogsUsageTab({ reference, refetchInterval }: LogsTabProps) {
  const [interval, setInterval] = useState<UsageInterval>("1day");
  const query = useQuery({
    queryKey: logsQueryKey(reference, "usage", interval),
    queryFn: () => supabaseStudioObservabilityUsage(reference, interval),
    refetchInterval,
  });
  return (
    <div className="space-y-3">
      <Select value={interval} onValueChange={(value) => setInterval(value as UsageInterval)}>
        <SelectTrigger size="sm" className="h-8 w-40 text-xs" aria-label="Zeitraum">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INTERVALS.map((item) => (
            <SelectItem key={item.id} value={item.id} className="text-xs">
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <LogsQueryState query={query}>
        {(data) => (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {COLUMNS.map(([key, label]) => (
                <div key={key} className="rounded-xl border p-3">
                  <div className="text-xs text-muted-foreground">{label}-Anfragen</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {formatNumber(data.rows.reduce((sum, row) => sum + (row[key] ?? 0), 0))}
                  </div>
                </div>
              ))}
            </div>
            <LogsListBlock
              title="Verlauf"
              headers={["Zeitpunkt", ...COLUMNS.map(([, label]) => label)]}
              rows={data.rows}
              hasMore={data.has_more}
              empty="Keine Nutzungsdaten im Zeitraum."
            >
              {(row) => (
                <tr key={String(row.timestamp)}>
                  <td className="whitespace-nowrap tabular-nums">
                    {formatLogTimestamp(row.timestamp)}
                  </td>
                  {COLUMNS.map(([key]) => (
                    <td key={key} className="tabular-nums">
                      {formatNumber(row[key] ?? 0)}
                    </td>
                  ))}
                </tr>
              )}
            </LogsListBlock>
          </div>
        )}
      </LogsQueryState>
    </div>
  );
}

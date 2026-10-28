import { useQuery } from "@tanstack/react-query";
import { supabaseStudioObservabilityLocks } from "@/lib/db/supabase-studio-observability";
import { formatMs, type LogsTabProps, logsQueryKey } from "./logs-format";
import { LogsListBlock } from "./logs-list-block";
import { LogsQueryState } from "./logs-query-state";

export function LogsLocksTab({ reference, refetchInterval }: LogsTabProps) {
  const query = useQuery({
    queryKey: logsQueryKey(reference, "locks"),
    queryFn: () => supabaseStudioObservabilityLocks(reference),
    refetchInterval,
  });
  return (
    <LogsQueryState query={query}>
      {(data) => (
        <div className="space-y-5">
          <LogsListBlock
            title="Blockierte Sitzungen"
            headers={["PID", "Rolle", "Wartet seit", "Abfrage", "Blockiert durch"]}
            rows={data.blocked.rows}
            hasMore={data.blocked.has_more}
            empty="Keine blockierten Sitzungen."
          >
            {(row) => (
              <tr key={row.pid}>
                <td className="tabular-nums">{row.pid}</td>
                <td>{row.usename ?? "–"}</td>
                <td className="whitespace-nowrap tabular-nums">{formatMs(row.waiting_ms)}</td>
                <td className="max-w-sm">
                  <code className="line-clamp-3 font-mono break-all">{row.query}</code>
                </td>
                <td className="max-w-sm space-y-1">
                  {row.blockers.map((blocker) => (
                    <div key={blocker.pid}>
                      <span className="font-medium tabular-nums">{blocker.pid}</span>{" "}
                      <span className="text-muted-foreground">
                        {blocker.usename ?? "–"} · {blocker.state ?? "–"}
                      </span>
                      <code className="line-clamp-2 font-mono break-all">{blocker.query}</code>
                    </div>
                  ))}
                </td>
              </tr>
            )}
          </LogsListBlock>
          <LogsListBlock
            title="Sperren"
            headers={["PID", "Typ", "Modus", "Gewährt", "Objekt", "Rolle", "Abfrage"]}
            rows={data.locks.rows}
            hasMore={data.locks.has_more}
            empty="Keine Sperren."
          >
            {(row, index) => (
              <tr key={`${row.pid}-${row.locktype}-${row.mode}-${row.relation}-${index}`}>
                <td className="tabular-nums">{row.pid ?? "–"}</td>
                <td>{row.locktype}</td>
                <td>{row.mode}</td>
                <td className={row.granted ? "" : "text-destructive"}>
                  {row.granted ? "ja" : "wartet"}
                </td>
                <td className="font-mono">{row.relation ?? row.transaction_id ?? "–"}</td>
                <td>{row.usename ?? "–"}</td>
                <td className="max-w-sm">
                  <code className="line-clamp-2 font-mono break-all">{row.query}</code>
                </td>
              </tr>
            )}
          </LogsListBlock>
        </div>
      )}
    </LogsQueryState>
  );
}

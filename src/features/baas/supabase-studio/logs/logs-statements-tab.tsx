import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type StatementOrder,
  supabaseStudioObservabilityStatements,
  supabaseStudioObservabilityStatementsEnable,
  supabaseStudioObservabilityStatementsReset,
} from "@/lib/db/supabase-studio-observability";
import { LogsConfirmDialog, type LogsConfirmRequest } from "./logs-confirm-dialog";
import { formatMs, formatNumber, type LogsTabProps, logsQueryKey } from "./logs-format";
import { LogsListBlock } from "./logs-list-block";
import { LogsQueryState } from "./logs-query-state";

const ORDERS: { id: StatementOrder; label: string }[] = [
  { id: "total", label: "Gesamtzeit" },
  { id: "mean", label: "Mittlere Zeit" },
  { id: "max", label: "Maximale Zeit" },
  { id: "calls", label: "Aufrufe" },
  { id: "rows", label: "Zeilen" },
];

export function LogsStatementsTab({ reference, refetchInterval }: LogsTabProps) {
  const queryClient = useQueryClient();
  const [order, setOrder] = useState<StatementOrder>("total");
  const [confirm, setConfirm] = useState<LogsConfirmRequest | null>(null);
  const query = useQuery({
    queryKey: logsQueryKey(reference, "statements", order),
    queryFn: () => supabaseStudioObservabilityStatements(reference, order),
    refetchInterval,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: logsQueryKey(reference, "statements") });
  const enable = useMutation({
    mutationFn: () => supabaseStudioObservabilityStatementsEnable(reference),
    onSuccess: () => {
      toast.success("pg_stat_statements aktiviert.");
      void refresh();
    },
    onError: (error) => toast.error(String(error)),
  });
  return (
    <LogsQueryState query={query}>
      {(data) =>
        !data.installed ? (
          <div className="space-y-2 rounded-xl border p-4 text-xs">
            <p>
              Die Erweiterung <code>pg_stat_statements</code> ist nicht installiert. Ohne sie gibt
              es keine Abfragestatistiken.
            </p>
            {data.available ? (
              <Button size="sm" disabled={enable.isPending} onClick={() => enable.mutate()}>
                Erweiterung aktivieren
              </Button>
            ) : (
              <p className="text-muted-foreground">
                Die Erweiterung ist auf diesem Server nicht verfügbar.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={order} onValueChange={(value) => setOrder(value as StatementOrder)}>
                <SelectTrigger size="sm" className="h-8 w-44 text-xs" aria-label="Sortierung">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDERS.map((item) => (
                    <SelectItem key={item.id} value={item.id} className="text-xs">
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-8 text-xs text-destructive"
                onClick={() =>
                  setConfirm({
                    title: "Abfragestatistiken zurücksetzen?",
                    description:
                      "Alle gesammelten Werte aus pg_stat_statements werden gelöscht. Das lässt sich nicht rückgängig machen.",
                    confirmLabel: "Zurücksetzen",
                    run: () => supabaseStudioObservabilityStatementsReset(reference),
                  })
                }
              >
                Statistiken zurücksetzen
              </Button>
            </div>
            <LogsListBlock
              title="Top-Abfragen"
              headers={[
                "Abfrage",
                "Rolle",
                "Aufrufe",
                "Gesamt",
                "Mittel",
                "Max",
                "Zeilen",
                "Cache",
              ]}
              rows={data.page.rows}
              hasMore={data.page.has_more}
              empty="Noch keine Statistiken gesammelt."
            >
              {(row, index) => {
                const blocks = row.shared_blks_hit + row.shared_blks_read;
                return (
                  <tr key={`${row.queryid}-${row.role}-${index}`}>
                    <td className="max-w-lg">
                      <code className="line-clamp-4 font-mono break-all">{row.query}</code>
                    </td>
                    <td>{row.role ?? "–"}</td>
                    <td className="tabular-nums">{formatNumber(row.calls)}</td>
                    <td className="whitespace-nowrap tabular-nums">{formatMs(row.total_ms)}</td>
                    <td className="whitespace-nowrap tabular-nums">{formatMs(row.mean_ms)}</td>
                    <td className="whitespace-nowrap tabular-nums">{formatMs(row.max_ms)}</td>
                    <td className="tabular-nums">{formatNumber(row.rows)}</td>
                    <td className="tabular-nums">
                      {blocks ? `${Math.round((row.shared_blks_hit / blocks) * 100)} %` : "–"}
                    </td>
                  </tr>
                );
              }}
            </LogsListBlock>
            <LogsConfirmDialog
              request={confirm}
              onClose={() => setConfirm(null)}
              onDone={() => {
                toast.success("Statistiken zurückgesetzt.");
                void refresh();
              }}
            />
          </div>
        )
      }
    </LogsQueryState>
  );
}

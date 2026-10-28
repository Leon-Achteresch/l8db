import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  type ObservabilitySession,
  supabaseStudioObservabilitySessions,
  supabaseStudioObservabilitySignal,
} from "@/lib/db/supabase-studio-observability";
import { DatabaseTable } from "../database/database-table";
import { LogsConfirmDialog, type LogsConfirmRequest } from "./logs-confirm-dialog";
import { formatMs, type LogsTabProps, logsQueryKey } from "./logs-format";

export function LogsSessionsTab({ reference, refetchInterval }: LogsTabProps) {
  const queryClient = useQueryClient();
  const [includeIdle, setIncludeIdle] = useState(false);
  const [confirm, setConfirm] = useState<LogsConfirmRequest | null>(null);
  const key = logsQueryKey(reference, "sessions", includeIdle);
  const query = useQuery({
    queryKey: key,
    queryFn: () => supabaseStudioObservabilitySessions(reference, includeIdle),
    placeholderData: keepPreviousData,
    refetchInterval,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: logsQueryKey(reference, "sessions") });
  const cancel = useMutation({
    mutationFn: (pid: number) => supabaseStudioObservabilitySignal(reference, pid, false),
    onSuccess: (ok) => {
      if (ok) toast.success("Abfrage abgebrochen.");
      else toast.error("Abbrechen nicht möglich.");
      void refresh();
    },
    onError: (error) => toast.error(String(error)),
  });
  const terminate = (session: ObservabilitySession) =>
    setConfirm({
      title: `Sitzung ${session.pid} beenden?`,
      description: `Die Verbindung von ${session.usename ?? "unbekannt"} wird getrennt, offene Transaktionen werden zurückgerollt.`,
      confirmLabel: "Beenden",
      run: () => supabaseStudioObservabilitySignal(reference, session.pid, true),
    });
  const rows = query.data?.rows ?? [];
  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-2 text-xs">
        <Switch checked={includeIdle} onCheckedChange={setIncludeIdle} />
        Inaktive Sitzungen anzeigen
      </Label>
      {query.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {String(query.error)}
        </p>
      ) : query.isPending ? (
        <p className="text-xs text-muted-foreground">Wird geladen…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Keine aktiven Sitzungen.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <DatabaseTable
            headers={["PID", "Rolle", "Client", "Status", "Wartet auf", "Dauer", "Abfrage", ""]}
          >
            {rows.map((session) => (
              <tr key={session.pid}>
                <td className="tabular-nums">{session.pid}</td>
                <td>
                  {session.usename ?? session.backend_type ?? "–"}
                  {session.application_name && (
                    <div className="text-muted-foreground">{session.application_name}</div>
                  )}
                </td>
                <td className="whitespace-nowrap">{session.client_addr ?? "lokal"}</td>
                <td>
                  {session.state ?? "–"}
                  {session.blocked_by.length > 0 && (
                    <div className="text-destructive">
                      blockiert von {session.blocked_by.join(", ")}
                    </div>
                  )}
                </td>
                <td>
                  {session.wait_event ? `${session.wait_event_type}: ${session.wait_event}` : "–"}
                </td>
                <td className="whitespace-nowrap tabular-nums">
                  {formatMs(session.duration_ms)}
                  {session.xact_ms !== null && (
                    <div className="text-muted-foreground">Tx {formatMs(session.xact_ms)}</div>
                  )}
                </td>
                <td className="max-w-md">
                  <code className="line-clamp-3 font-mono break-all">{session.query}</code>
                </td>
                <td className="whitespace-nowrap text-right">
                  {session.backend_type === "client backend" && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={cancel.isPending || session.state !== "active"}
                        title={session.state !== "active" ? "Keine laufende Abfrage." : undefined}
                        onClick={() => cancel.mutate(session.pid)}
                      >
                        Abbrechen
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-destructive"
                        onClick={() => terminate(session)}
                      >
                        Beenden
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </DatabaseTable>
        </div>
      )}
      {query.data?.has_more && (
        <p className="text-xs text-muted-foreground">
          Angezeigt werden die {rows.length} ältesten Sitzungen.
        </p>
      )}
      <LogsConfirmDialog
        request={confirm}
        onClose={() => setConfirm(null)}
        onDone={() => {
          toast.success("Sitzung beendet.");
          void refresh();
        }}
      />
    </div>
  );
}

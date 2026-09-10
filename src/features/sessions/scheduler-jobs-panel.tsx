import { useQueryClient } from "@tanstack/react-query";
import { CalendarClockIcon, PlayIcon, PowerIcon, PowerOffIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useActiveConnection } from "@/lib/connections";
import { runSchedulerJob, setSchedulerJobEnabled } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useSchedulerJobsQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";

export function SchedulerJobsPanel() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const { data: jobs, isLoading, isError, error } = useSchedulerJobsQuery();
  const [actingId, setActingId] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["scheduler-jobs"] });
  };

  const toggle = async (id: string, name: string, enabled: boolean) => {
    if (!connection) return;
    if (
      !window.confirm(
        enabled ? `Job ${name} wirklich aktivieren?` : `Job ${name} wirklich deaktivieren?`,
      )
    )
      return;
    setActingId(id);
    try {
      await setSchedulerJobEnabled(
        connection.kind,
        effectiveConnectionString(connection),
        id,
        enabled,
        database ?? undefined,
      );
      toast.success(enabled ? `Job ${name} aktiviert.` : `Job ${name} deaktiviert.`);
      refresh();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setActingId(null);
    }
  };

  const runNow = async (id: string, name: string) => {
    if (!connection) return;
    if (!window.confirm(`Job ${name} jetzt ausführen?`)) return;
    setActingId(id);
    try {
      await runSchedulerJob(
        connection.kind,
        effectiveConnectionString(connection),
        id,
        database ?? undefined,
      );
      toast.success(`Job ${name} gestartet.`);
      refresh();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setActingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <Spinner />
        Lade Jobs…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center">
        <CalendarClockIcon className="size-5 text-muted-foreground" />
        <p className="max-w-xl text-sm text-muted-foreground">{String(error)}</p>
      </div>
    );
  }

  if (!jobs || jobs.length === 0) {
    return <p className="p-8 text-center text-sm text-muted-foreground">Keine Jobs vorhanden.</p>;
  }

  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
        <tr>
          <th className="px-3 py-2 font-medium">Job</th>
          <th className="px-3 py-2 font-medium">Status</th>
          <th className="px-3 py-2 font-medium">Zeitplan</th>
          <th className="px-3 py-2 font-medium">Letzter Lauf</th>
          <th className="px-3 py-2 font-medium">Nächster Lauf</th>
          <th className="px-3 py-2 font-medium">Letzte Meldung</th>
          <th className="px-3 py-2 text-right font-medium">Aktionen</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/50">
        {jobs.map((job) => (
          <tr key={job.id} className="hover:bg-muted/30">
            <td className="px-3 py-2 font-mono">
              {job.owner ? `${job.owner}.` : ""}
              {job.name}
              <div className="max-w-md truncate text-[11px] text-muted-foreground">
                {job.command}
              </div>
            </td>
            <td className="px-3 py-2">
              <Badge
                variant="outline"
                className={`px-1.5 py-0 text-[10px] ${job.enabled ? "" : "text-muted-foreground"}`}
              >
                {job.state}
              </Badge>
            </td>
            <td className="px-3 py-2 font-mono text-[11px]">{job.schedule || "—"}</td>
            <td className="px-3 py-2">
              {job.last_run ?? "—"}
              {job.last_status ? (
                <div className="text-[11px] text-muted-foreground">{job.last_status}</div>
              ) : null}
            </td>
            <td className="px-3 py-2">{job.next_run ?? "—"}</td>
            <td className="px-3 py-2">
              {job.last_error ? (
                <span className="text-destructive">{job.last_error}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
            <td className="px-3 py-2">
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 px-2 text-xs"
                  disabled={actingId === job.id}
                  onClick={() => void runNow(job.id, job.name)}
                >
                  <PlayIcon className="size-3.5" />
                  Ausführen
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 px-2 text-xs"
                  disabled={actingId === job.id}
                  onClick={() => void toggle(job.id, job.name, !job.enabled)}
                >
                  {job.enabled ? (
                    <PowerOffIcon className="size-3.5" />
                  ) : (
                    <PowerIcon className="size-3.5" />
                  )}
                  {job.enabled ? "Deaktivieren" : "Aktivieren"}
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

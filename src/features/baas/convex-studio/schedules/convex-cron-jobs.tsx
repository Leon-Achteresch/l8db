import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type ConvexCronJob,
  type ConvexStudioTarget,
  convexCronJobs,
  convexRunCron,
} from "@/lib/db/convex-studio-schedules";
import { ConvexCronRuns } from "./convex-cron-runs";
import { ConvexSchedulesConfirmDialog } from "./convex-schedules-confirm-dialog";
import {
  CRON_STATUS,
  formatJson,
  formatRelative,
  formatScheduleTime,
} from "./convex-schedules-format";
import { useSchedulesConfirm } from "./use-schedules-confirm";

interface Props {
  target: ConvexStudioTarget;
  refetchInterval: number | false;
}

export function ConvexCronJobs({ target, refetchInterval }: Props) {
  const baseKey = ["convex", target.profileId, target.deploymentName, "cron-jobs"];
  const { setConfirm, dialog } = useSchedulesConfirm(baseKey);
  const [open, setOpen] = useState<string | null>(null);
  const crons = useQuery({
    queryKey: baseKey,
    queryFn: () => convexCronJobs(target),
    refetchInterval,
  });

  const runNow = (cron: ConvexCronJob) =>
    setConfirm({
      title: `„${cron.name}“ jetzt ausführen?`,
      description: `${cron.function} wird sofort mit den Argumenten des Cron-Jobs ausgeführt. Der reguläre Zeitplan bleibt unverändert.`,
      action: "Jetzt ausführen",
      destructive: false,
      run: () => convexRunCron(target, cron.name),
    });

  if (crons.isError)
    return (
      <p role="alert" className="text-xs text-destructive">
        {String(crons.error)}
      </p>
    );
  if (crons.isPending) return <p className="text-xs text-muted-foreground">Wird geladen…</p>;
  if (crons.data.length === 0)
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
        Keine Cron-Jobs. Lege sie in <code>convex/crons.ts</code> an und deploye die App.
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            {["", "Name", "Zeitplan", "Funktion", "Letzter Lauf", "Nächster Lauf", ""].map(
              (header, index) => (
                <th
                  key={`${header}-${index.toString()}`}
                  className="px-3 py-2 font-medium whitespace-nowrap"
                >
                  {header}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y [&_td]:px-3 [&_td]:py-2 [&_td]:align-top">
          {crons.data.map((cron) => {
            const expanded = open === cron.name;
            return (
              <Fragment key={cron.name}>
                <tr
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setOpen(expanded ? null : cron.name)}
                >
                  <td>
                    {expanded ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                  </td>
                  <td className="font-medium">{cron.name}</td>
                  <td>{cron.description}</td>
                  <td className="font-mono">{cron.function}</td>
                  <td className="whitespace-nowrap">
                    {cron.lastRun ? (
                      <span className="flex items-center gap-2">
                        <Badge variant={cron.lastRun.status === "err" ? "destructive" : "outline"}>
                          {CRON_STATUS[cron.lastRun.status] ?? cron.lastRun.status}
                        </Badge>
                        {formatScheduleTime(cron.lastRun.tsMs)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Noch nie</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    {formatScheduleTime(cron.nextRunMs)}{" "}
                    <span className="text-muted-foreground">{formatRelative(cron.nextRunMs)}</span>
                  </td>
                  <td className="text-right">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Jetzt ausführen"
                      title="Jetzt ausführen"
                      onClick={(event) => {
                        event.stopPropagation();
                        runNow(cron);
                      }}
                    >
                      <Play />
                    </Button>
                  </td>
                </tr>
                {expanded && (
                  <tr>
                    <td />
                    <td colSpan={6} className="space-y-3 bg-muted/20">
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className="space-y-1">
                          <div className="font-medium">Argumente</div>
                          <pre className="max-h-60 overflow-auto rounded-md border bg-background p-2 font-mono">
                            {formatJson(cron.args)}
                          </pre>
                          <div className="font-medium">Zeitplan (roh)</div>
                          <pre className="overflow-auto rounded-md border bg-background p-2 font-mono">
                            {formatJson(cron.schedule)}
                          </pre>
                        </div>
                        <div className="space-y-1">
                          <div className="font-medium">Letzte Läufe</div>
                          <ConvexCronRuns
                            target={target}
                            name={cron.name}
                            refetchInterval={refetchInterval}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <ConvexSchedulesConfirmDialog {...dialog} />
    </div>
  );
}

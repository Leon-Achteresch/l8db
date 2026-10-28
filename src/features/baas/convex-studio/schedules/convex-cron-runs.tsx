import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { type ConvexStudioTarget, convexCronRuns } from "@/lib/db/convex-studio-schedules";
import { CRON_STATUS, formatScheduleTime } from "./convex-schedules-format";

const RUN_LIMIT = 50;

interface Props {
  target: ConvexStudioTarget;
  name: string;
  refetchInterval: number | false;
}

export function ConvexCronRuns({ target, name, refetchInterval }: Props) {
  const runs = useQuery({
    queryKey: ["convex", target.profileId, target.deploymentName, "cron-jobs", "runs", name],
    queryFn: () => convexCronRuns(target, name, RUN_LIMIT),
    refetchInterval,
  });
  if (runs.isError)
    return (
      <p role="alert" className="text-xs text-destructive">
        {String(runs.error)}
      </p>
    );
  if (runs.isPending) return <p className="text-xs text-muted-foreground">Wird geladen…</p>;
  if (runs.data.length === 0)
    return <p className="text-xs text-muted-foreground">Noch keine Läufe aufgezeichnet.</p>;
  return (
    <ul className="divide-y rounded-md border text-xs">
      {runs.data.map((run) => (
        <li key={run.id} className="space-y-1 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={run.status === "err" ? "destructive" : "outline"}>
              {CRON_STATUS[run.status] ?? run.status}
            </Badge>
            <span>{formatScheduleTime(run.tsMs)}</span>
            {run.executionMs != null && (
              <span className="text-muted-foreground">{run.executionMs.toFixed(1)} ms</span>
            )}
          </div>
          {run.error && <p className="text-destructive">{run.error}</p>}
          {run.logLines.length > 0 && (
            <pre className="max-h-40 overflow-auto rounded bg-muted/40 p-1.5 font-mono">
              {run.logLines.join("\n")}
              {run.truncated && "\n…"}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}

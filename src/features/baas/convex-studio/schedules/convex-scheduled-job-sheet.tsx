import { useQuery } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  type ConvexScheduledJob,
  type ConvexStudioTarget,
  convexScheduledJobArgs,
} from "@/lib/db/convex-studio-schedules";
import {
  formatJson,
  formatRelative,
  formatScheduleTime,
  JOB_STATES,
} from "./convex-schedules-format";

interface Props {
  target: ConvexStudioTarget;
  job: ConvexScheduledJob | null;
  onCancel: (job: ConvexScheduledJob) => void;
  onClose: () => void;
}

export function ConvexScheduledJobSheet({ target, job, onCancel, onClose }: Props) {
  const argsId = job?.args == null ? job?.argsId : null;
  const args = useQuery({
    queryKey: ["convex", target.profileId, target.deploymentName, "job-args", argsId],
    queryFn: () => convexScheduledJobArgs(target, argsId ?? ""),
    enabled: !!argsId,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const value = job?.args ?? args.data;
  const rows: [string, string][] = job
    ? [
        ["ID", job.id],
        ["Status", JOB_STATES[job.state] ?? job.state],
        [
          "Geplant für",
          `${formatScheduleTime(job.scheduledMs)} (${formatRelative(job.scheduledMs)})`,
        ],
        ["Ursprünglich geplant", formatScheduleTime(job.originalScheduledMs)],
        ["Erstellt", formatScheduleTime(job.createdMs)],
        ["Abgeschlossen", formatScheduleTime(job.completedMs)],
        ["Versuche", formatJson(job.attempts)],
      ]
    : [];
  return (
    <Sheet open={job !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-mono text-sm">{job?.function}</SheetTitle>
          <SheetDescription>Geplante Funktion</SheetDescription>
        </SheetHeader>
        {job && (
          <div className="space-y-4 px-4 pb-4 text-xs">
            <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              {rows.map(([label, text]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-mono break-all whitespace-pre-wrap">{text}</dd>
                </div>
              ))}
            </dl>
            {job.error && (
              <p role="alert" className="rounded-md bg-destructive/10 p-2 text-destructive">
                {job.error}
              </p>
            )}
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-medium">
                Argumente {args.isFetching && <Badge variant="outline">lädt…</Badge>}
              </div>
              {args.isError ? (
                <p role="alert" className="text-destructive">
                  {String(args.error)}
                </p>
              ) : (
                <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-2 font-mono">
                  {formatJson(value)}
                </pre>
              )}
            </div>
            {(job.state === "pending" || job.state === "inProgress") && (
              <Button size="sm" variant="destructive" onClick={() => onCancel(job)}>
                <Ban className="size-3.5" /> Abbrechen
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

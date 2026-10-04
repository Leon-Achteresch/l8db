import { CircleAlertIcon, LoaderCircleIcon, SquareIcon } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/backup";
import { jobProgress } from "@/lib/branching/model";
import { type BranchingJob, cancelExecution } from "@/lib/db";
import { useNow } from "@/lib/hooks/use-now";
import { VersioningIconButton } from "../versioning-icon-button";

const RECENT_MS = 15 * 60_000;

export function BranchingJobs({ jobs }: { jobs: BranchingJob[] }) {
  const now = useNow();
  const visible = jobs.filter(
    (job) =>
      job.state === "running" ||
      (job.state === "failed" && now - Date.parse(job.finishedAt ?? job.startedAt) < RECENT_MS),
  );
  if (!visible.length) return null;
  return (
    <ul className="space-y-2" aria-label="Laufende Branching-Vorgänge">
      {visible.map((job) => {
        const percent = jobProgress(job);
        return (
          <li key={job.id} className="rounded-xl bg-muted/40 px-3 py-2.5">
            <div className="flex items-center gap-2">
              {job.state === "running" ? (
                <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-primary" />
              ) : (
                <CircleAlertIcon className="size-3.5 shrink-0 text-destructive" />
              )}
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{job.label}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {job.state === "running"
                  ? `${job.phase}${percent === null ? (job.done > 0 ? ` · ${formatBytes(job.done)}` : "") : ` · ${percent} %`}`
                  : "Fehlgeschlagen"}
              </span>
              {job.state === "running" && (
                <VersioningIconButton
                  icon={SquareIcon}
                  label="Vorgang abbrechen"
                  className="size-6 [&_svg]:size-3"
                  onClick={() => void cancelExecution(job.id)}
                />
              )}
            </div>
            {job.state === "running" && (
              <Progress
                value={percent ?? 0}
                className={percent === null ? "mt-2 opacity-40" : "mt-2"}
              />
            )}
            {job.state === "failed" && job.error && (
              <p className="mt-1.5 line-clamp-4 whitespace-pre-line break-words text-[11px] leading-relaxed text-destructive">
                {job.error}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

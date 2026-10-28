import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Ban, ListX } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type ConvexScheduledJob,
  type ConvexStudioTarget,
  convexCancelAllScheduledJobs,
  convexCancelScheduledJob,
  convexSchedulableFunctions,
  convexScheduledJobs,
} from "@/lib/db/convex-studio-schedules";
import { ConvexScheduleRunHint } from "./convex-schedule-run-hint";
import { ConvexScheduledJobSheet } from "./convex-scheduled-job-sheet";
import { ConvexSchedulesConfirmDialog } from "./convex-schedules-confirm-dialog";
import { formatRelative, formatScheduleTime, JOB_STATES } from "./convex-schedules-format";
import { useSchedulesConfirm } from "./use-schedules-confirm";

const PAGE_SIZE = 50;
const ALL = "__all";

interface Props {
  target: ConvexStudioTarget;
  refetchInterval: number | false;
}

export function ConvexScheduledJobs({ target, refetchInterval }: Props) {
  const [udfPath, setUdfPath] = useState(ALL);
  const [state, setState] = useState(ALL);
  const [selected, setSelected] = useState<ConvexScheduledJob | null>(null);
  const baseKey = ["convex", target.profileId, target.deploymentName, "scheduled-jobs"];
  const { setConfirm, dialog } = useSchedulesConfirm(baseKey);
  const functions = useQuery({
    queryKey: ["convex", target.profileId, target.deploymentName, "schedulable-functions"],
    queryFn: () => convexSchedulableFunctions(target),
    staleTime: 60_000,
  });
  const filterPath = udfPath === ALL ? null : udfPath;
  const jobs = useInfiniteQuery({
    queryKey: [...baseKey, filterPath],
    queryFn: ({ pageParam }) => convexScheduledJobs(target, filterPath, pageParam, PAGE_SIZE),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => (page.hasMore ? page.cursor : undefined),
    refetchInterval,
  });
  const loaded = useMemo(() => jobs.data?.pages.flatMap((page) => page.jobs) ?? [], [jobs.data]);
  const visible = state === ALL ? loaded : loaded.filter((job) => job.state === state);
  const filterLabel =
    functions.data?.find((fn) => fn.udfPath === filterPath)?.function ?? filterPath;

  const cancelJob = (job: ConvexScheduledJob) =>
    setConfirm({
      title: "Geplante Funktion abbrechen?",
      description: `${job.function}, geplant für ${formatScheduleTime(job.scheduledMs)}, wird nicht ausgeführt.`,
      action: "Abbrechen",
      destructive: true,
      run: async () => {
        await convexCancelScheduledJob(target, job.id);
        setSelected(null);
      },
    });
  const cancelAll = () =>
    setConfirm({
      title: filterPath
        ? `Alle Läufe von ${filterLabel} abbrechen?`
        : "Alle geplanten Funktionen abbrechen?",
      description: filterPath
        ? `Alle ausstehenden und laufenden Aufrufe von ${filterLabel} werden abgebrochen.`
        : "Alle ausstehenden und laufenden geplanten Funktionen dieses Deployments werden abgebrochen. Das lässt sich nicht rückgängig machen.",
      action: "Alle abbrechen",
      destructive: true,
      run: () => convexCancelAllScheduledJobs(target, filterPath),
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={udfPath} onValueChange={setUdfPath}>
          <SelectTrigger size="sm" className="h-8 w-64 text-xs" aria-label="Funktion">
            <SelectValue placeholder="Funktion" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL} className="text-xs">
              Alle Funktionen
            </SelectItem>
            {functions.data?.map((fn) => (
              <SelectItem key={fn.udfPath} value={fn.udfPath} className="font-mono text-xs">
                {fn.function}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={state} onValueChange={setState}>
          <SelectTrigger size="sm" className="h-8 w-40 text-xs" aria-label="Status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL} className="text-xs">
              Alle Status
            </SelectItem>
            <SelectItem value="pending" className="text-xs">
              {JOB_STATES.pending}
            </SelectItem>
            <SelectItem value="inProgress" className="text-xs">
              {JOB_STATES.inProgress}
            </SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          className="text-destructive"
          disabled={loaded.length === 0}
          onClick={cancelAll}
        >
          <ListX className="size-3.5" />{" "}
          {filterPath ? "Alle dieser Funktion abbrechen" : "Alle abbrechen"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Convex führt hier nur ausstehende und laufende Aufrufe. Abgeschlossene, fehlgeschlagene und
        abgebrochene Läufe erscheinen in den Logs (Aufrufer „Scheduler“).
      </p>
      {jobs.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {String(jobs.error)}
        </p>
      ) : jobs.isPending ? (
        <p className="text-xs text-muted-foreground">Wird geladen…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
          Keine geplanten Funktionen.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {["Funktion", "Status", "Geplant für", "Erstellt", ""].map((header) => (
                  <th key={header} className="px-3 py-2 font-medium whitespace-nowrap">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y [&_td]:px-3 [&_td]:py-2">
              {visible.map((job) => (
                <tr
                  key={job.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setSelected(job)}
                >
                  <td className="font-mono">{job.function}</td>
                  <td>
                    <Badge variant={job.state === "inProgress" ? "default" : "outline"}>
                      {JOB_STATES[job.state] ?? job.state}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap">
                    {formatScheduleTime(job.scheduledMs)}{" "}
                    <span className="text-muted-foreground">{formatRelative(job.scheduledMs)}</span>
                  </td>
                  <td className="whitespace-nowrap text-muted-foreground">
                    {formatScheduleTime(job.createdMs)}
                  </td>
                  <td className="text-right">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Abbrechen"
                      title="Abbrechen"
                      onClick={(event) => {
                        event.stopPropagation();
                        cancelJob(job);
                      }}
                    >
                      <Ban />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {jobs.hasNextPage && (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="outline"
            disabled={jobs.isFetchingNextPage}
            onClick={() => jobs.fetchNextPage()}
          >
            {jobs.isFetchingNextPage ? "Wird geladen…" : "Mehr laden"}
          </Button>
        </div>
      )}
      <ConvexScheduleRunHint functions={functions.data ?? []} />
      <ConvexScheduledJobSheet
        target={target}
        job={selected}
        onCancel={cancelJob}
        onClose={() => setSelected(null)}
      />
      <ConvexSchedulesConfirmDialog {...dialog} />
    </div>
  );
}

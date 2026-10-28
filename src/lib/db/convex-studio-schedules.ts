import { invoke } from "./core";

export interface ConvexStudioTarget {
  profileId: string;
  projectId: number;
  deploymentName: string;
}

export interface ConvexScheduledJob {
  id: string;
  udfPath: string;
  function: string;
  state: string;
  error: string | null;
  scheduledMs: number | null;
  originalScheduledMs: number | null;
  completedMs: number | null;
  createdMs: number | null;
  argsId: string | null;
  args: unknown;
  attempts: unknown;
}

export interface ConvexScheduledJobPage {
  jobs: ConvexScheduledJob[];
  cursor: string | null;
  hasMore: boolean;
}

export interface ConvexCronRun {
  id: string;
  name: string;
  function: string;
  tsMs: number | null;
  status: string;
  error: string | null;
  executionMs: number | null;
  logLines: string[];
  truncated: boolean;
}

export interface ConvexCronJob {
  name: string;
  udfPath: string;
  function: string;
  schedule: unknown;
  description: string;
  args: unknown;
  nextRunMs: number | null;
  lastRun: ConvexCronRun | null;
}

export interface ConvexSchedulableFunction {
  udfPath: string;
  function: string;
  kind: "mutation" | "action";
  internal: boolean;
}

const base = (target: ConvexStudioTarget) => ({
  id: target.profileId,
  projectId: target.projectId,
  deploymentName: target.deploymentName,
});

export const convexScheduledJobs = (
  target: ConvexStudioTarget,
  udfPath: string | null,
  cursor: string | null,
  limit: number,
) =>
  invoke<ConvexScheduledJobPage>("convex_studio_schedules_jobs", {
    ...base(target),
    udfPath,
    cursor,
    limit,
  });

export const convexScheduledJobArgs = (target: ConvexStudioTarget, argsId: string) =>
  invoke<unknown>("convex_studio_schedules_job_args", { ...base(target), argsId });

export const convexCancelScheduledJob = (target: ConvexStudioTarget, jobId: string) =>
  invoke<void>("convex_studio_schedules_cancel_job", { ...base(target), jobId });

export const convexCancelAllScheduledJobs = (target: ConvexStudioTarget, udfPath: string | null) =>
  invoke<void>("convex_studio_schedules_cancel_all", {
    ...base(target),
    udfPath,
    fromMs: null,
    untilMs: null,
  });

export const convexSchedulableFunctions = (target: ConvexStudioTarget) =>
  invoke<ConvexSchedulableFunction[]>("convex_studio_schedules_functions", base(target));

export const convexCronJobs = (target: ConvexStudioTarget) =>
  invoke<ConvexCronJob[]>("convex_studio_schedules_crons", base(target));

export const convexCronRuns = (target: ConvexStudioTarget, name: string | null, limit: number) =>
  invoke<ConvexCronRun[]>("convex_studio_schedules_cron_runs", { ...base(target), name, limit });

export const convexRunCron = (target: ConvexStudioTarget, name: string) =>
  invoke<unknown>("convex_studio_schedules_run_cron", { ...base(target), name });

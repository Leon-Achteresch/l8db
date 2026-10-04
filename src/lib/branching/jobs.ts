import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { SavedConnection } from "@/lib/connections";
import { type BranchingJob, branchingJobs, cancelExecution } from "@/lib/db";
import { finishTask, startTask, updateTask } from "@/lib/tasks";
import { jobProgress } from "./model";

interface BranchingJobsState {
  jobs: Record<string, BranchingJob>;
}

export const useBranchingJobs = create<BranchingJobsState>(() => ({ jobs: {} }));

const tracked = new Set<string>();
const waiters = new Map<string, ((job: BranchingJob) => void)[]>();
let listening: Promise<void> | null = null;

function settled(job: BranchingJob): boolean {
  return job.state !== "running";
}

function apply(job: BranchingJob) {
  useBranchingJobs.setState((state) => ({ jobs: { ...state.jobs, [job.id]: job } }));
  if (tracked.has(job.id)) {
    const percent = jobProgress(job);
    updateTask(job.id, {
      detail: job.log.at(-1)?.slice(0, 300) ?? job.phase,
      ...(percent === null ? {} : { progress: percent, total: 100 }),
    });
    if (settled(job)) {
      tracked.delete(job.id);
      finishTask(
        job.id,
        job.result ?? undefined,
        job.state === "succeeded" ? undefined : (job.error ?? "Vorgang vom Benutzer abgebrochen."),
      );
    }
  }
  if (settled(job)) {
    for (const resolve of waiters.get(job.id) ?? []) resolve(job);
    waiters.delete(job.id);
  }
}

export function watchBranchingJobs(): Promise<void> {
  listening ??= (async () => {
    await listen<BranchingJob>("branching-job", ({ payload }) => apply(payload)).catch(
      () => undefined,
    );
    const known = useBranchingJobs.getState().jobs;
    for (const job of await branchingJobs().catch(() => [])) if (!known[job.id]) apply(job);
  })();
  return listening;
}

export function waitForJob(id: string): Promise<BranchingJob> {
  const known = useBranchingJobs.getState().jobs[id];
  if (known && settled(known)) return Promise.resolve(known);
  return new Promise((resolve) => waiters.set(id, [...(waiters.get(id) ?? []), resolve]));
}

export async function runBranchingJob(
  start: () => Promise<string>,
  title: string,
  connection: SavedConnection,
  database: string | null,
): Promise<BranchingJob> {
  await watchBranchingJobs();
  const id = await start();
  tracked.add(id);
  try {
    startTask(
      { id, title, connectionId: connection.id, connectionName: connection.name, database },
      () => cancelExecution(id),
    );
  } catch {
    tracked.delete(id);
  }
  const known = useBranchingJobs.getState().jobs[id];
  if (known) apply(known);
  const job = await waitForJob(id);
  if (job.state !== "succeeded") throw new Error(job.error ?? "Vorgang abgebrochen.");
  return job;
}

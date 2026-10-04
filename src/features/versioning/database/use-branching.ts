import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useBackupToolPaths } from "@/lib/backup-runner";
import { runBranchingJob, useBranchingJobs, watchBranchingJobs } from "@/lib/branching/jobs";
import { serverJobs } from "@/lib/branching/model";
import type { SavedConnection } from "@/lib/connections";
import { type BranchingJob, type BranchingOverview, branchingOverview } from "@/lib/db";
import { useDbSelectionStore } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

export interface BranchingWorkspace {
  connection: SavedConnection;
  database: string;
  overview: BranchingOverview | undefined;
  loading: boolean;
  error: string | null;
  busy: boolean;
  jobs: BranchingJob[];
  toolPaths: Record<string, string>;
  url: () => string;
  refresh: () => Promise<void>;
  run: (task: () => Promise<unknown>, success?: string) => Promise<boolean>;
  job: (
    title: string,
    start: (url: string) => Promise<string>,
    database: string | null,
    success: (job: BranchingJob) => string,
  ) => Promise<BranchingJob | null>;
  openDatabase: (name: string) => void;
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error: /, "");
}

export function useBranching(connection: SavedConnection, database: string): BranchingWorkspace {
  const toolPaths = useBackupToolPaths((state) => state.paths);
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const queryKey = ["branching-overview", connection.id, database, toolPaths];
  const query = useQuery({
    queryKey,
    retry: false,
    staleTime: 15_000,
    queryFn: () => branchingOverview(effectiveConnectionString(connection), database, toolPaths),
  });
  const allJobs = useBranchingJobs((state) => state.jobs);
  useEffect(() => {
    void watchBranchingJobs();
  }, []);
  const identity = query.data?.server.identity;
  const jobs = serverJobs(Object.values(allJobs), identity).sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  const refresh = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["branching-overview", connection.id] }),
      client.invalidateQueries({ queryKey: ["branching-audit"] }),
    ]);
  }, [client, connection.id]);
  const run = useCallback(
    async (task: () => Promise<unknown>, success?: string) => {
      setBusy(true);
      try {
        await task();
        if (success) toast.success(success);
        return true;
      } catch (error) {
        toast.error(message(error));
        return false;
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [refresh],
  );
  const job = useCallback(
    async (
      title: string,
      start: (url: string) => Promise<string>,
      target: string | null,
      success: (job: BranchingJob) => string,
    ) => {
      try {
        const finished = await runBranchingJob(
          () => start(effectiveConnectionString(connection)),
          title,
          connection,
          target,
        );
        toast.success(success(finished));
        return finished;
      } catch (error) {
        toast.error(message(error));
        return null;
      } finally {
        await refresh();
      }
    },
    [connection, refresh],
  );
  const openDatabase = useCallback(
    (name: string) => {
      useDbSelectionStore.getState().setDatabase(connection.id, name);
      toast.success(`„${name}“ ist jetzt die aktive Datenbank.`);
    },
    [connection.id],
  );
  return {
    connection,
    database,
    overview: query.data,
    loading: query.isLoading,
    error: query.error ? message(query.error) : null,
    busy,
    jobs,
    toolPaths,
    url: () => effectiveConnectionString(connection),
    refresh,
    run,
    job,
    openDatabase,
  };
}

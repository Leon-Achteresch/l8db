import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ConvexLogTarget,
  convexStudioLogsCancel,
  convexStudioLogsFetch,
} from "@/lib/db/convex-studio-logs";
import { type ConvexExecution, mergeLogEntries } from "./convex-logs-buffer";

const LIVE_WAIT_MS = 20_000;
const MANUAL_WAIT_MS = 1_500;
const RETRY_MS = 5_000;
const IDLE_MS = 1_000;

export function useConvexLogStream(target: ConvexLogTarget, live: boolean) {
  const manualId = useRef<string | null>(null);
  const [executions, setExecutions] = useState<ConvexExecution[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dropped, setDropped] = useState(0);
  const cursor = useRef(0);
  const { profileId, projectId, deploymentName } = target;

  const fetchOnce = useCallback(
    async (waitMs: number, streamId: string) => {
      const from = cursor.current;
      const batch = await convexStudioLogsFetch(
        { profileId, projectId, deploymentName },
        streamId,
        from,
        waitMs,
      );
      if (cursor.current !== from) return batch;
      cursor.current = Math.max(from, batch.newCursor);
      if (batch.dropped) setDropped((value) => value + batch.dropped);
      setExecutions((previous) => mergeLogEntries(previous, batch.entries));
      setError(null);
      return batch;
    },
    [profileId, projectId, deploymentName],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    const streamId = `logs-${crypto.randomUUID()}`;
    manualId.current = streamId;
    try {
      await fetchOnce(MANUAL_WAIT_MS, streamId);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }, [fetchOnce]);

  useEffect(() => {
    cursor.current = 0;
    setExecutions([]);
    setDropped(0);
    void refresh();
    return () => {
      if (manualId.current) void convexStudioLogsCancel(manualId.current).catch(() => undefined);
    };
  }, [refresh]);

  useEffect(() => {
    if (!live) return;
    let stopped = false;
    const streamId = `logs-${crypto.randomUUID()}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      while (!stopped) {
        let pause = 0;
        try {
          const batch = await fetchOnce(LIVE_WAIT_MS, streamId);
          if (batch.entries.length === 0 && !batch.timedOut) pause = IDLE_MS;
        } catch (reason) {
          if (stopped) return;
          setError(String(reason));
          pause = RETRY_MS;
        }
        if (pause && !stopped)
          await new Promise<void>((resolve) => {
            timer = setTimeout(resolve, pause);
          });
      }
    };
    void run();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      void convexStudioLogsCancel(streamId).catch(() => undefined);
    };
  }, [live, fetchOnce]);

  const clear = useCallback(() => {
    setExecutions([]);
    setDropped(0);
  }, []);

  return { executions, error, loading, dropped, refresh, clear };
}

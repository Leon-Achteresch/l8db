import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { secondsSince } from "@/features/monitor/monitor-view/format";
import { copyWithToast } from "@/lib/clipboard";
import { useActiveConnection } from "@/lib/connections";
import { cancelSession, getLiveMetrics, type SessionInfo, terminateSession } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import {
  averageOf,
  type LiveInterval,
  type LiveRange,
  liveKey,
  needsDetails,
  percentChange,
  pointsInRange,
  startLivePolling,
  useLiveMonitorStore,
} from "@/lib/live-monitor";
import { useLocksQuery, useSessionsQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";

export const LIVE_SESSION_RENDER_LIMIT = 200;

export interface LiveSessionFilters {
  search: string;
  state: string;
  user: string;
  database: string;
}

const EMPTY_FILTERS: LiveSessionFilters = { search: "", state: "", user: "", database: "" };

export function sessionRuntime(session: SessionInfo, now: number): number | null {
  const legacy = session.query_start?.match(/^vor (\d+) s$/);
  if (legacy) return Number(legacy[1]);
  if (session.state && session.state !== "active" && session.state_change)
    return secondsSince(session.state_change, now);
  return secondsSince(session.query_start ?? session.backend_start, now);
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function useLiveMonitor() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const capabilities = useActiveCapabilities();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const [interval, setIntervalMs] = useState<LiveInterval>(5000);
  const [paused, setPaused] = useState(false);
  const [range, setRange] = useState<LiveRange>(30);
  const pollNow = useRef<(() => void) | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [filters, setFilters] = useState<LiveSessionFilters>(EMPTY_FILTERS);
  const [actingPid, setActingPid] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pollInterval = paused ? false : interval;
  const sessionsQuery = useSessionsQuery(pollInterval);
  const locksQuery = useLocksQuery(pollInterval);
  const key = connection ? liveKey(connection.id, database) : null;
  const series = useLiveMonitorStore();
  const ownSeries = series.key === key;
  const live = Boolean(connection && capabilities.live_monitor);

  useEffect(() => {
    if (!connection || !key || !capabilities.live_monitor || paused) return;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const includeDetails = needsDetails(useLiveMonitorStore.getState(), key, Date.now());
        try {
          const metrics = await getLiveMetrics(
            connection.kind,
            effectiveConnectionString(connection),
            includeDetails,
            database ?? undefined,
          );
          if (cancelled) return;
          useLiveMonitorStore.getState().push(key, { at: Date.now(), metrics }, includeDetails);
          setMetricsError(null);
        } catch (error) {
          if (!cancelled) setMetricsError(typeof error === "string" ? error : String(error));
        }
        if (!cancelled) setNow(Date.now());
      } finally {
        inFlight = false;
      }
    };
    const stop = startLivePolling({
      intervalMs: interval,
      isHidden: () => document.hidden,
      poll,
    });
    pollNow.current = () => void poll();
    return () => {
      cancelled = true;
      pollNow.current = null;
      stop();
    };
  }, [capabilities.live_monitor, connection, database, interval, key, paused]);

  useEffect(() => {
    if (paused || live) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, interval);
    return () => window.clearInterval(timer);
  }, [interval, live, paused]);

  const refresh = useCallback(() => {
    setNow(Date.now());
    pollNow.current?.();
    void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    void queryClient.invalidateQueries({ queryKey: ["locks"] });
  }, [queryClient]);

  const metrics = ownSeries ? (series.last?.metrics ?? null) : null;
  const allPoints = ownSeries ? series.points : [];
  const points = useMemo(() => pointsInRange(allPoints, now, range), [allPoints, now, range]);
  const latest = points.at(-1) ?? null;
  const locks = useMemo(() => locksQuery.data ?? [], [locksQuery.data]);

  const tpsAverage = useMemo(() => averageOf(points, (point) => point.tps), [points]);
  const firstSize = useMemo(
    () => points.find((point) => point.sizeBytes != null)?.sizeBytes ?? null,
    [points],
  );
  const sizeBytes = ownSeries ? series.sizeBytes : null;

  const sessionsList = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const filterOptions = useMemo(
    () => ({
      states: uniqueSorted(sessionsList.map((session) => session.state ?? "")),
      users: uniqueSorted(sessionsList.map((session) => session.user)),
      databases: uniqueSorted(sessionsList.map((session) => session.database)),
    }),
    [sessionsList],
  );
  const filteredSessions = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return sessionsList.filter(
      (session) =>
        (!filters.state || session.state === filters.state) &&
        (!filters.user || session.user === filters.user) &&
        (!filters.database || session.database === filters.database) &&
        (!search ||
          String(session.pid).includes(search) ||
          session.user.toLowerCase().includes(search) ||
          session.application.toLowerCase().includes(search) ||
          (session.client_addr ?? "").toLowerCase().includes(search) ||
          session.query.toLowerCase().includes(search)),
    );
  }, [filters, sessionsList]);

  const selectedSession = useMemo(() => {
    if (selectedPid != null) {
      const match = sessionsList.find((session) => session.pid === selectedPid);
      if (match) return match;
    }
    return (
      filteredSessions.find((session) => session.state === "active" && !session.is_self) ??
      filteredSessions[0] ??
      null
    );
  }, [filteredSessions, selectedPid, sessionsList]);

  const waitingLocks = metrics?.waiting_locks ?? locks.filter((lock) => !lock.granted).length;
  const connections = metrics?.connections ?? sessionsList.length;
  const activeSessions = sessionsList.filter(
    (session) => session.state === "active" || session.state?.startsWith("idle in transaction"),
  ).length;

  const lastUpdatedAt = Math.max(
    ownSeries ? (series.last?.at ?? 0) : 0,
    sessionsQuery.dataUpdatedAt ?? 0,
    locksQuery.dataUpdatedAt ?? 0,
  );

  const runAction = async (
    pid: number,
    action: "cancel" | "terminate",
    confirmText?: string,
  ): Promise<void> => {
    if (!connection) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setActingPid(pid);
    try {
      const run = action === "cancel" ? cancelSession : terminateSession;
      const result = await run(
        connection.kind,
        effectiveConnectionString(connection),
        pid,
        database ?? undefined,
      );
      toast.success(
        action === "cancel"
          ? result
            ? `Abfrage auf PID ${pid} gestoppt.`
            : `PID ${pid}: nichts zu stoppen.`
          : `Sitzung ${pid} beendet.`,
      );
      refresh();
    } catch (error) {
      toast.error(typeof error === "string" ? error : String(error));
    } finally {
      setActingPid(null);
    }
  };

  return {
    connection,
    database,
    capabilities,
    live,
    interval,
    setInterval: setIntervalMs,
    paused,
    setPaused,
    range,
    setRange,
    refresh,
    now,
    metrics,
    metricsError,
    points,
    latest,
    tpsChange: percentChange(latest?.tps ?? null, tpsAverage),
    sizeBytes,
    sizeChange: percentChange(sizeBytes, firstSize),
    tableIo: ownSeries ? series.tableIo : [],
    sessionsQuery,
    locksQuery,
    sessions: sessionsList,
    locks,
    filters,
    setFilters,
    resetFilters: () => setFilters(EMPTY_FILTERS),
    filterOptions,
    filteredSessions,
    selectedSession: detailsOpen ? selectedSession : null,
    highlightedPid: detailsOpen ? (selectedSession?.pid ?? null) : null,
    selectSession: (pid: number) => {
      setSelectedPid(pid);
      setDetailsOpen(true);
    },
    closeDetails: () => setDetailsOpen(false),
    actingPid,
    waitingLocks,
    connections,
    activeSessions,
    lastUpdatedAt,
    stopQuery: (pid: number) => runAction(pid, "cancel"),
    terminate: (pid: number) =>
      runAction(
        pid,
        "terminate",
        `Sitzung mit PID ${pid} wirklich beenden? Offene Transaktionen gehen verloren.`,
      ),
    copyQuery: (sql: string) => void copyWithToast(sql, "Abfrage"),
    openInEditor: (sql: string, pid: number) => {
      const id = openQueryTabWithSql(sql, `PID ${pid}`);
      void navigate({ to: "/query/$id", params: { id } });
    },
  };
}

export type LiveMonitorState = ReturnType<typeof useLiveMonitor>;

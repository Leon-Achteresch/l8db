import { useEffect, useMemo, useState } from "react";
import { EMPTY_SERVER_OUTPUT } from "@/features/monitor/monitor-view/constants";
import { formatTime, sessionPriority } from "@/features/monitor/monitor-view/format";
import type {
  HistoryFilter,
  HistoryRange,
  MonitorTab,
} from "@/features/monitor/monitor-view/types";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import {
  useDatabaseOverviewQuery,
  useLocksQuery,
  useRefreshConnection,
  useSessionsQuery,
} from "@/lib/queries";
import { type QueryHistoryEntry, useQueryHistoryStore } from "@/lib/query-history";
import {
  collectServerOutput,
  toggleServerOutput as toggleServerOutputOnConnection,
  useServerOutputStore,
} from "@/lib/server-output";
import { effectiveConnectionString } from "@/lib/ssh";

export function useMonitorView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const capabilities = useActiveCapabilities();
  const { refresh, isRefreshing } = useRefreshConnection();
  const sessionsQuery = useSessionsQuery(5000);
  const locksQuery = useLocksQuery(5000);
  const overviewQuery = useDatabaseOverviewQuery(30_000);
  const historyEntries = useQueryHistoryStore((state) => state.entries);
  const clearHistory = useQueryHistoryStore((state) => state.clearForConnection);
  const serverOutputEnabled = useServerOutputStore((state) =>
    connection ? state.enabled[connection.id] === true : false,
  );
  const serverOutputEntries = useServerOutputStore((state) =>
    connection ? (state.entries[connection.id] ?? EMPTY_SERVER_OUTPUT) : EMPTY_SERVER_OUTPUT,
  );
  const clearServerOutput = useServerOutputStore((state) => state.clear);
  const [tab, setTab] = useState<MonitorTab>("performance");
  const [range, setRange] = useState<HistoryRange>("7d");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [historySearch, setHistorySearch] = useState("");
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [serverOutputBusy, setServerOutputBusy] = useState(false);

  useEffect(() => {
    if (!connection || !capabilities.server_output || !serverOutputEnabled) return;
    const collect = () => {
      if (document.hidden) return;
      void collectServerOutput(
        connection.kind,
        effectiveConnectionString(connection),
        connection.id,
        database ?? undefined,
      ).catch(() => undefined);
    };
    collect();
    const timer = window.setInterval(collect, 2500);
    return () => window.clearInterval(timer);
  }, [capabilities.server_output, connection, database, serverOutputEnabled]);

  const scopedHistory = useMemo(() => {
    if (!connection) return [];
    const cutoff =
      range === "24h"
        ? Date.now() - 24 * 60 * 60 * 1000
        : range === "7d"
          ? Date.now() - 7 * 24 * 60 * 60 * 1000
          : 0;
    return historyEntries.filter(
      (entry) =>
        entry.connectionId === connection.id &&
        entry.database === database &&
        entry.ranAt >= cutoff,
    );
  }, [connection, database, historyEntries, range]);

  const measuredHistory = useMemo(
    () =>
      scopedHistory.filter(
        (entry): entry is QueryHistoryEntry & { durationMs: number } =>
          typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs),
      ),
    [scopedHistory],
  );

  const stats = useMemo(() => {
    const totalDuration = measuredHistory.reduce((sum, entry) => sum + entry.durationMs, 0);
    const slowest = measuredHistory.reduce<(QueryHistoryEntry & { durationMs: number }) | null>(
      (current, entry) => (!current || entry.durationMs > current.durationMs ? entry : current),
      null,
    );
    return {
      total: scopedHistory.length,
      errors: scopedHistory.filter((entry) => Boolean(entry.error)).length,
      success: scopedHistory.filter((entry) => !entry.error).length,
      average: measuredHistory.length ? totalDuration / measuredHistory.length : null,
      slowest,
    };
  }, [measuredHistory, scopedHistory]);

  const latencyData = useMemo(
    () =>
      measuredHistory
        .slice(0, 30)
        .reverse()
        .map((entry) => ({
          label: formatTime(entry.ranAt),
          duration: entry.durationMs,
        })),
    [measuredHistory],
  );

  const slowQueries = useMemo(
    () =>
      [...measuredHistory].sort((left, right) => right.durationMs - left.durationMs).slice(0, 8),
    [measuredHistory],
  );

  const filteredHistory = useMemo(() => {
    const search = historySearch.trim().toLowerCase();
    return scopedHistory.filter((entry) => {
      const matchesFilter =
        historyFilter === "all" ||
        (historyFilter === "error" && Boolean(entry.error)) ||
        (historyFilter === "success" && !entry.error);
      return matchesFilter && (!search || entry.sql.toLowerCase().includes(search));
    });
  }, [historyFilter, historySearch, scopedHistory]);

  const scopedServerOutput = useMemo(
    () =>
      serverOutputEntries.filter(
        (entry) => !database || entry.database === database || entry.database === null,
      ),
    [database, serverOutputEntries],
  );

  const visibleSessions = useMemo(
    () =>
      [...(sessionsQuery.data ?? [])]
        .sort((left, right) => sessionPriority(left) - sessionPriority(right))
        .slice(0, 16),
    [sessionsQuery.data],
  );

  const activeSessions = sessionsQuery.data?.filter((session) => session.state === "active").length;
  const blockedSessions = sessionsQuery.data?.filter(
    (session) => session.blocked_by.length > 0,
  ).length;
  const lastUpdatedAt = Math.max(
    sessionsQuery.dataUpdatedAt ?? 0,
    locksQuery.dataUpdatedAt ?? 0,
    overviewQuery.dataUpdatedAt ?? 0,
  );

  const toggleServerOutput = async (enabled: boolean) => {
    if (!connection) return;
    setServerOutputBusy(true);
    try {
      await toggleServerOutputOnConnection(
        connection.kind,
        effectiveConnectionString(connection),
        connection.id,
        enabled,
        database ?? undefined,
      );
    } finally {
      setServerOutputBusy(false);
    }
  };

  return {
    connection,
    database,
    capabilities,
    refresh,
    isRefreshing,
    sessionsQuery,
    locksQuery,
    overviewQuery,
    clearHistory,
    serverOutputEnabled,
    clearServerOutput,
    tab,
    setTab,
    range,
    setRange,
    historyFilter,
    setHistoryFilter,
    historySearch,
    setHistorySearch,
    expandedHistoryId,
    setExpandedHistoryId,
    serverOutputBusy,
    scopedHistory,
    measuredHistory,
    stats,
    latencyData,
    slowQueries,
    filteredHistory,
    scopedServerOutput,
    visibleSessions,
    activeSessions,
    blockedSessions,
    lastUpdatedAt,
    toggleServerOutput,
  };
}

export type MonitorViewState = ReturnType<typeof useMonitorView>;

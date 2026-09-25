import { useNavigate } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { DataCompareSideSelection } from "@/features/compare/data-compare-side-picker";
import { errorMessage } from "@/features/compare/data-compare-view/lib";
import { loadSide } from "@/features/compare/data-compare-view/load-side";
import type { CategoryFilter, CompareState } from "@/features/compare/data-compare-view/types";
import { copyText } from "@/lib/clipboard";
import { useConnectionsStore } from "@/lib/connections";
import {
  buildSyncScript,
  type DataDiffRow,
  planDataCompare,
  type SyncDirection,
} from "@/lib/data-compare";
import { cancelExecution, compareTableDataRemote } from "@/lib/db";
import { useDbSelectionStore } from "@/lib/db-selection";
import { capabilitiesFor } from "@/lib/providers";
import { activateConnection, effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import { finishTask, startTask, updateTask } from "@/lib/tasks";

export function useDataCompare(left: DataCompareSideSelection, right: DataCompareSideSelection) {
  const navigate = useNavigate();
  const connections = useConnectionsStore((state) => state.connections);
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<CompareState | null>(null);
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [direction, setDirection] = useState<SyncDirection>("left_to_right");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeDeletes, setIncludeDeletes] = useState(false);

  const leftConnection = connections.find((item) => item.id === left.connectionId) ?? null;
  const rightConnection = connections.find((item) => item.id === right.connectionId) ?? null;
  const ready = Boolean(
    leftConnection &&
      rightConnection &&
      capabilitiesFor(leftConnection.kind).data_compare &&
      capabilitiesFor(rightConnection.kind).data_compare &&
      left.schema &&
      left.table &&
      right.schema &&
      right.table,
  );

  const runCompare = async () => {
    if (!ready || running || !leftConnection || !rightConnection) return;
    setRunning(true);
    setError(null);
    setState(null);
    setSelected(new Set());
    let cancelled = false;
    let backendStarted = false;
    const job = startTask(
      { title: "Datenvergleich", connectionId: leftConnection.id, database: left.database },
      async () => {
        cancelled = true;
        return backendStarted ? cancelExecution(job) : true;
      },
    );
    const unlisten = await listen<{ jobId: string; rows: number }>(
      "data-compare-progress",
      (event) => {
        if (event.payload.jobId === job)
          updateTask(job, {
            progress: event.payload.rows,
            detail: "Zeilen der aktuellen Seite werden gelesen.",
          });
      },
    ).catch(() => () => {});
    try {
      const [leftSide, rightSide] = await Promise.all([
        loadSide(leftConnection, left),
        loadSide(rightConnection, right),
      ]);
      const plan = planDataCompare({
        leftColumns: leftSide.columns,
        rightColumns: rightSide.columns,
        leftKeyColumns: leftSide.keyColumns,
        rightKeyColumns: rightSide.keyColumns,
      });
      if (plan.error) {
        throw new Error(plan.error);
      }
      const source = (side: DataCompareSideSelection) => ({
        schema: side.schema as string,
        table: side.table as string,
        filter: side.filter,
        allowRawFilter: false,
        orderDesc: false,
        isView: false,
        maxRows: 1_000_000,
      });
      if (cancelled) throw new Error("Vergleich vom Benutzer abgebrochen.");
      backendStarted = true;
      const result = await compareTableDataRemote(
        {
          left: {
            connectionString: effectiveConnectionString(leftConnection),
            database: left.database,
            kind: leftConnection.kind,
            source: source(left),
          },
          right: {
            connectionString: effectiveConnectionString(rightConnection),
            database: right.database,
            kind: rightConnection.kind,
            source: source(right),
          },
          keyColumns: plan.keyColumns,
          compareColumns: plan.compareColumns,
        },
        { jobId: job, track: false },
      );
      if (cancelled) throw new Error("Vergleich vom Benutzer abgebrochen.");
      finishTask(job, result.counts);
      setState({
        result,
        keyColumns: plan.keyColumns,
        compareColumns: plan.compareColumns,
        columnTypes: {
          left: Object.fromEntries(
            leftSide.columns.map((column) => [column.name, column.data_type]),
          ),
          right: Object.fromEntries(
            rightSide.columns.map((column) => [column.name, column.data_type]),
          ),
        },
        left,
        right,
      });
      setSelected(
        new Set(result.rows.filter((row) => row.category !== "equal").map((row) => row.keyText)),
      );
    } catch (loadError) {
      finishTask(job, undefined, loadError);
      setError(errorMessage(loadError));
    } finally {
      unlisten();
      setRunning(false);
    }
  };

  const visibleRows = useMemo(() => {
    if (!state) return [];
    if (filter === "all") return state.result.rows;
    return state.result.rows.filter((row) => row.category === filter);
  }, [state, filter]);

  const scriptRows = useMemo(() => {
    if (!state) return [] as DataDiffRow[];
    return state.result.rows.filter((row) => row.category !== "equal" && selected.has(row.keyText));
  }, [state, selected]);

  const script = useMemo(() => {
    if (!state) return null;
    const target = direction === "left_to_right" ? state.right : state.left;
    if (!target.table) return null;
    try {
      const connection =
        direction === "left_to_right"
          ? connections.find((item) => item.id === state.right.connectionId)
          : connections.find((item) => item.id === state.left.connectionId);
      return {
        target: `${target.schema}.${target.table}`,
        ...buildSyncScript({
          rows: scriptRows,
          direction,
          target: { schema: target.schema, table: target.table },
          keyColumns: state.keyColumns,
          compareColumns: state.compareColumns,
          kind: connection?.kind ?? null,
          columnTypes:
            direction === "left_to_right" ? state.columnTypes.right : state.columnTypes.left,
          includeDeletes,
        }),
        error: null as string | null,
      };
    } catch (scriptError) {
      return {
        target: `${target.schema}.${target.table}`,
        sql: "",
        insertCount: 0,
        updateCount: 0,
        deleteCount: 0,
        keys: [] as string[],
        error: errorMessage(scriptError),
      };
    }
  }, [state, scriptRows, direction, connections, includeDeletes]);

  const toggleRow = (keyText: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(keyText)) next.delete(keyText);
      else next.add(keyText);
      return next;
    });
  };

  const copyScript = async () => {
    if (!script?.sql) return;
    await copyText(script.sql);
    toast.success("Skript kopiert");
  };

  const openScript = async () => {
    if (!script?.sql || !state) return;
    const target = direction === "left_to_right" ? state.right : state.left;
    if (!target.connectionId || !target.database) return;
    const outcome = await activateConnection(target.connectionId);
    if (!outcome.ok) {
      toast.error(outcome.error ?? "Zielverbindung konnte nicht aktiviert werden.");
      return;
    }
    useDbSelectionStore.getState().setDatabase(target.connectionId, target.database);
    const id = openQueryTabWithSql(script.sql, "Datenabgleich", false);
    await navigate({ to: "/query/$id", params: { id } });
    toast.success("Skript in neuem Query-Tab geöffnet (nicht ausgeführt)");
  };

  return {
    running,
    error,
    state,
    filter,
    setFilter,
    direction,
    setDirection,
    includeDeletes,
    setIncludeDeletes,
    selected,
    leftConnection,
    rightConnection,
    ready,
    runCompare,
    visibleRows,
    script,
    toggleRow,
    copyScript,
    openScript,
  };
}

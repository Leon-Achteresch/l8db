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
  compareTableData,
  type DataDiffRow,
  planDataCompare,
  type SyncDirection,
} from "@/lib/data-compare";
import { useTableTabs } from "@/lib/table-tabs";

export function useDataCompare(left: DataCompareSideSelection, right: DataCompareSideSelection) {
  const connections = useConnectionsStore((state) => state.connections);
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<CompareState | null>(null);
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [direction, setDirection] = useState<SyncDirection>("left_to_right");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const leftConnection = connections.find((item) => item.id === left.connectionId) ?? null;
  const rightConnection = connections.find((item) => item.id === right.connectionId) ?? null;
  const ready = Boolean(
    leftConnection && rightConnection && left.schema && left.table && right.schema && right.table,
  );

  const runCompare = async () => {
    if (!leftConnection || !rightConnection) return;
    setRunning(true);
    setError(null);
    setState(null);
    setSelected(new Set());
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
        setError(plan.error);
        return;
      }
      const result = compareTableData({
        keyColumns: plan.keyColumns,
        compareColumns: plan.compareColumns,
        left: leftSide.rows,
        right: rightSide.rows,
      });
      setState({
        result,
        keyColumns: plan.keyColumns,
        compareColumns: plan.compareColumns,
        leftCapturedAt: leftSide.capturedAt,
        rightCapturedAt: rightSide.capturedAt,
        left,
        right,
      });
      setSelected(
        new Set(result.rows.filter((row) => row.category !== "equal").map((row) => row.keyText)),
      );
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
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
        }),
        error: null as string | null,
      };
    } catch (scriptError) {
      return {
        target: `${target.schema}.${target.table}`,
        sql: "",
        insertCount: 0,
        updateCount: 0,
        keys: [] as string[],
        error: errorMessage(scriptError),
      };
    }
  }, [state, scriptRows, direction, connections]);

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

  const openScript = () => {
    if (!script?.sql) return;
    openQueryTabWithSql(script.sql, "Datenabgleich");
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

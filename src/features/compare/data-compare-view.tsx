import { ClipboardCopyIcon, PlayIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import {
  buildSyncScript,
  compareTableData,
  DATA_COMPARE_MAX_ROWS,
  type DataCompareResult,
  type DataDiffCategory,
  type DataDiffRow,
  planDataCompare,
  type SyncDirection,
} from "@/lib/data-compare";
import { fetchTableRows, listConstraints, listTableColumnsDetailed } from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";

import {
  DataCompareSidePicker,
  type DataCompareSideSelection,
  EMPTY_DATA_SIDE,
} from "./data-compare-side-picker";

type CategoryFilter = DataDiffCategory | "all";

interface LoadedSide {
  columns: { name: string; data_type: string }[];
  keyColumns: string[];
  rows: Record<string, unknown>[];
  capturedAt: string;
}

interface CompareState {
  result: DataCompareResult;
  keyColumns: string[];
  compareColumns: string[];
  leftCapturedAt: string;
  rightCapturedAt: string;
  left: DataCompareSideSelection;
  right: DataCompareSideSelection;
}

const CATEGORY_LABEL: Record<DataDiffCategory, string> = {
  only_left: "Nur links",
  only_right: "Nur rechts",
  changed: "Geändert",
  equal: "Gleich",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sideLabel(side: DataCompareSideSelection, connection: SavedConnection | null): string {
  if (!connection || !side.schema || !side.table) return "–";
  return `${connection.name} · ${side.database ?? ""} · ${side.schema}.${side.table}`;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function loadSide(
  connection: SavedConnection,
  side: DataCompareSideSelection,
): Promise<LoadedSide> {
  const url = effectiveConnectionString(connection);
  const database = side.database ?? undefined;
  const schema = side.schema as string;
  const table = side.table as string;
  const [detailed, constraints] = await Promise.all([
    listTableColumnsDetailed(connection.kind, url, schema, table, database),
    listConstraints(connection.kind, url, schema, table, database),
  ]);
  const primary = constraints.find((item) => item.constraint_type === "PRIMARY KEY");
  const keyColumns =
    primary && primary.columns.length > 0
      ? primary.columns
      : detailed.filter((column) => column.is_primary_key).map((column) => column.name);
  const data = await fetchTableRows(
    connection.kind,
    url,
    schema,
    table,
    undefined,
    DATA_COMPARE_MAX_ROWS + 1,
    0,
    database,
  );
  if (data.rows.length > DATA_COMPARE_MAX_ROWS)
    throw new Error(
      `Tabelle ${schema}.${table} überschreitet das Limit von ${DATA_COMPARE_MAX_ROWS} Zeilen je Seite.`,
    );
  return {
    columns: detailed.map((column) => ({ name: column.name, data_type: column.data_type })),
    keyColumns,
    rows: data.rows,
    capturedAt: new Date().toLocaleString(),
  };
}

export function DataCompareView() {
  const connections = useConnectionsStore((state) => state.connections);
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const [left, setLeft] = useState<DataCompareSideSelection>(EMPTY_DATA_SIDE);
  const [right, setRight] = useState<DataCompareSideSelection>(EMPTY_DATA_SIDE);
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
    await navigator.clipboard.writeText(script.sql);
    toast.success("Skript kopiert");
  };

  const openScript = () => {
    if (!script?.sql) return;
    openQueryTabWithSql(script.sql, "Datenabgleich");
    toast.success("Skript in neuem Query-Tab geöffnet (nicht ausgeführt)");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <DataCompareSidePicker title="Links (Quelle)" value={left} onChange={setLeft} />
        <DataCompareSidePicker title="Rechts (Ziel)" value={right} onChange={setRight} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void runCompare()} disabled={!ready || running}>
          <PlayIcon className="size-3.5" />
          {running ? "Vergleiche…" : "Vergleichen"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Höchstens {DATA_COMPARE_MAX_ROWS} Zeilen je Seite; gleiche Spaltenstruktur und
          Primärschlüssel erforderlich.
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {state && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              Links {sideLabel(state.left, leftConnection)} · erfasst {state.leftCapturedAt}
            </span>
            <span>
              Rechts {sideLabel(state.right, rightConnection)} · erfasst {state.rightCapturedAt}
            </span>
            <span>Beide Seiten wurden nacheinander gelesen, kein zeitgleicher Snapshot.</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Schlüssel: {state.keyColumns.join(", ")}</Badge>
            {(["only_left", "only_right", "changed", "equal"] as DataDiffCategory[]).map(
              (category) => (
                <Badge key={category} variant="secondary">
                  {CATEGORY_LABEL[category]}: {state.result.counts[category]}
                </Badge>
              ),
            )}
            <div className="ml-auto flex items-center gap-2">
              <Label className="text-xs">Filter</Label>
              <Select value={filter} onValueChange={(value) => setFilter(value as CategoryFilter)}>
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    Alle
                  </SelectItem>
                  {(["only_left", "only_right", "changed", "equal"] as DataDiffCategory[]).map(
                    (category) => (
                      <SelectItem key={category} value={category} className="text-xs">
                        {CATEGORY_LABEL[category]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <ScrollArea className="max-h-80 rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="w-8 px-2 py-1"></th>
                  <th className="px-2 py-1 text-left font-medium">Kategorie</th>
                  <th className="px-2 py-1 text-left font-medium">Schlüssel</th>
                  <th className="px-2 py-1 text-left font-medium">Unterschiede</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.keyText} className="border-t">
                    <td className="px-2 py-1">
                      {row.category !== "equal" && (
                        <Checkbox
                          checked={selected.has(row.keyText)}
                          onCheckedChange={() => toggleRow(row.keyText)}
                        />
                      )}
                    </td>
                    <td className="px-2 py-1">{CATEGORY_LABEL[row.category]}</td>
                    <td className="px-2 py-1 font-mono">
                      {state.keyColumns
                        .map((column) => `${column}=${cellText(row.keyValues[column])}`)
                        .join(", ")}
                    </td>
                    <td className="px-2 py-1 font-mono text-muted-foreground">
                      {row.differences
                        .map(
                          (diff) =>
                            `${diff.column}: ${cellText(diff.left)} → ${cellText(diff.right)}`,
                        )
                        .join(" | ")}
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-4 text-center text-muted-foreground">
                      Keine Zeilen in dieser Kategorie.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </ScrollArea>

          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs">Richtung</Label>
            <Select
              value={direction}
              onValueChange={(value) => setDirection(value as SyncDirection)}
            >
              <SelectTrigger className="h-8 w-64 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left_to_right" className="text-xs">
                  Links nach rechts
                </SelectItem>
                <SelectItem value="right_to_left" className="text-xs">
                  Rechts nach links
                </SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              Ziel: {script?.target ?? "–"} · {script?.insertCount ?? 0} INSERT ·{" "}
              {script?.updateCount ?? 0} UPDATE · Schlüssel:{" "}
              {script?.keys.slice(0, 5).join("; ") || "–"}
              {script && script.keys.length > 5 ? " …" : ""}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void copyScript()}
                disabled={!script?.sql}
              >
                <ClipboardCopyIcon className="size-3.5" />
                Kopieren
              </Button>
              <Button size="sm" variant="outline" onClick={openScript} disabled={!script?.sql}>
                <SquareArrowOutUpRightIcon className="size-3.5" />
                Als Query-Tab
              </Button>
            </div>
          </div>

          {script?.error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {script.error}
            </div>
          )}

          <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
            {script?.sql || "Keine Änderungen ausgewählt."}
          </pre>
          <span className="text-xs text-muted-foreground">
            Das Skript wird nur erzeugt und nie automatisch ausgeführt; UPDATE prüft den erwarteten
            Altstand.
          </span>
        </>
      )}
    </div>
  );
}

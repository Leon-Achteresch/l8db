import type { SortingState } from "@tanstack/react-table";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryResultTable } from "../../src/features/query/query-result-table";
import { DataTable } from "../../src/features/table/data-table";
import { initAppearance } from "../../src/lib/appearance";
import { useSettingsStore } from "../../src/lib/settings";

const params = new URLSearchParams(location.search);
const ROWS = Number(params.get("rows") ?? 5000);
const duration = Number(params.get("duration") ?? 2000);
const step = Number(params.get("step") ?? 120);
useSettingsStore.setState({
  uiScale: Number(params.get("scale") ?? 100),
  uiDensity: (params.get("density") ?? "normal") as "normal" | "compact" | "spacious",
});
initAppearance();

const foreignKeys =
  params.get("fk") === "1"
    ? [
        {
          constraint_name: "perf_fk",
          from_schema: "public",
          from_table: "perf_items",
          from_column: "id",
          to_schema: "public",
          to_table: "parents",
          to_column: "id",
        },
      ]
    : undefined;
const longText = "x".repeat(Number(params.get("textSize") ?? 0));
const COLUMNS = Array.from(
  { length: Number(new URLSearchParams(location.search).get("columns") ?? 12) },
  (_, i) => `col_${i}`,
);

function makeRows(asResult = false) {
  return Array.from({ length: ROWS }, (_, row) => {
    const record: Record<string, unknown> = {
      __ctid__: `(0,${row})`,
      id: asResult ? String(row) : row,
    };
    for (const column of COLUMNS) {
      const n = row * 31 + column.length;
      const value = longText
        ? longText
        : n % 5 === 0
          ? null
          : n % 5 === 1
            ? n
            : n % 5 === 2
              ? `2026-01-${String((n % 28) + 1).padStart(2, "0")}T10:00:00Z`
              : n % 5 === 3
                ? { nested: n }
                : `value ${n}`;
      record[column] =
        asResult && value !== null
          ? typeof value === "object"
            ? JSON.stringify(value)
            : String(value)
          : value;
    }
    return record;
  });
}

function App() {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [data] = useState(() => (params.get("kind") === "result" ? [] : makeRows()));
  const [result] = useState(() =>
    new URLSearchParams(location.search).get("kind") !== "result"
      ? null
      : {
          columns: ["id", ...COLUMNS],
          rows: makeRows(true) as Record<string, string | null>[],
          rows_affected: ROWS,
          execution_time_ms: 0,
        },
  );
  if (new URLSearchParams(location.search).get("kind") === "result")
    return (
      <QueryResultTable
        result={result}
        isLoading={false}
        error={null}
        onInspect={(column, value, row) => {
          (window as unknown as { inspected: unknown }).inspected = { column, value, row };
        }}
      />
    );
  return (
    <DataTable
      columns={["id", ...COLUMNS]}
      data={data}
      emptyMessage="leer"
      foreignKeys={foreignKeys}
      currentSchema="public"
      currentTable="perf_items"
      onNavigateToTable={(schema, table, filter) => {
        (window as unknown as { navigated: unknown }).navigated = { schema, table, filter };
      }}
      sorting={sorting}
      onSortingChange={setSorting}
      pageSize={ROWS}
      onSaveRow={async (ctid, updates) => {
        (window as unknown as { saved: unknown }).saved = { ctid, updates };
      }}
      onDeleteRow={() => undefined}
    />
  );
}

const mountStart = performance.now();
createRoot(document.getElementById("root") as HTMLElement).render(<App />);

async function measure() {
  await new Promise<void>((resolve) => {
    const tick = () =>
      document.querySelector("tbody tr[data-index]") ? resolve() : requestAnimationFrame(tick);
    tick();
  });
  const mountMs = performance.now() - mountStart;
  const scroller = document.querySelector<HTMLElement>("[data-perf-scroller], .overflow-auto");
  if (!scroller) throw new Error("scroll container not found");
  const renderedRows = document.querySelectorAll("tbody tr[data-index]").length;
  const renderedCells = document.querySelectorAll("tbody td:not([aria-hidden])").length;
  await document.fonts.ready;
  await new Promise((resolve) => setTimeout(resolve, 500));
  const sample = async (axis: "vertical" | "horizontal" | "diagonal") => {
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const frames: number[] = [];
    const heights = new Set<number>();
    let previous = 0;
    let start = 0;
    let direction = 1;
    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        if (!start) start = now;
        if (previous) frames.push(now - previous);
        previous = now;
        if (axis !== "horizontal") {
          scroller.scrollTop += step;
          if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight)
            scroller.scrollTop = 0;
        }
        if (axis !== "vertical") {
          heights.add(
            document.querySelector("tbody tr[data-index]")!.getBoundingClientRect().height,
          );
          scroller.scrollLeft += direction * step;
          if (scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth) direction = -1;
          if (scroller.scrollLeft <= 0) direction = 1;
        }
        if (now - start < duration) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    const sorted = [...frames].sort((a, b) => a - b);
    return {
      fps: (frames.length / frames.reduce((a, b) => a + b, 0)) * 1000,
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      worst: Math.max(...frames),
      overBudgetPercent:
        (frames.filter((frame) => frame > 1000 / 60 + 2).length / frames.length) * 100,
      frames: frames.length,
      heights: [...heights],
    };
  };
  const vertical = await sample("vertical");
  const rowsAfterScroll = document.querySelectorAll("tbody tr[data-index]").length;
  const horizontal = await sample("horizontal");
  const diagonal = await sample("diagonal");
  scroller.scrollTop = 0;
  scroller.scrollLeft = 0;
  await new Promise((resolve) => setTimeout(resolve, 250));
  const heapMb = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    ?.usedJSHeapSize;
  return {
    mountMs,
    renderedRows,
    renderedCells,
    rowsAfterScroll,
    fps: vertical.fps,
    worstFrameMs: vertical.worst,
    horizontalHeights: horizontal.heights,
    horizontalFps: horizontal.fps,
    horizontalWorstFrameMs: horizontal.worst,
    vertical,
    horizontal,
    diagonal,
    heapMb: heapMb === undefined ? null : heapMb / 1024 / 1024,
    totalRows: ROWS,
  };
}

(window as unknown as { result: Promise<unknown> }).result = measure();

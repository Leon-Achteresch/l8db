import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { SortingState } from "@tanstack/react-table";
import { DataTable } from "../../src/features/table/data-table";

const ROWS = 5000;
const COLUMNS = Array.from({ length: 12 }, (_, i) => `col_${i}`);

function makeRows() {
  return Array.from({ length: ROWS }, (_, row) => {
    const record: Record<string, unknown> = { __ctid__: `(0,${row})`, id: row };
    for (const column of COLUMNS) {
      const n = row * 31 + column.length;
      record[column] =
        n % 5 === 0
          ? null
          : n % 5 === 1
            ? n
            : n % 5 === 2
              ? `2026-01-${String((n % 28) + 1).padStart(2, "0")}T10:00:00Z`
              : n % 5 === 3
                ? { nested: n }
                : `value ${n}`;
    }
    return record;
  });
}

function App() {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [data] = useState(makeRows);
  return (
    <DataTable
      columns={["id", ...COLUMNS]}
      data={data}
      emptyMessage="leer"
      sorting={sorting}
      onSortingChange={setSorting}
      pageSize={ROWS}
      onDeleteRow={() => undefined}
    />
  );
}

const mountStart = performance.now();
createRoot(document.getElementById("root") as HTMLElement).render(<App />);

async function measure() {
  await new Promise<void>((resolve) => {
    const tick = () => (document.querySelector("tbody tr") ? resolve() : requestAnimationFrame(tick));
    tick();
  });
  const mountMs = performance.now() - mountStart;
  const scroller = document.querySelector<HTMLElement>("[data-perf-scroller], .overflow-auto");
  if (!scroller) throw new Error("scroll container not found");
  const renderedRows = document.querySelectorAll("tbody tr[data-row-index]").length;
  const frames: number[] = [];
  let last = performance.now();
  const end = last + 1500;
  await new Promise<void>((resolve) => {
    const frame = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      scroller.scrollTop += 120;
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight) scroller.scrollTop = 0;
      if (now < end) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
  const total = frames.reduce((a, b) => a + b, 0);
  const fps = (frames.length / total) * 1000;
  const worstFrameMs = Math.max(...frames);
  const rowsAfterScroll = document.querySelectorAll("tbody tr[data-row-index]").length;
  const heapMb =
    (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ??
    0;
  return {
    mountMs,
    renderedRows,
    rowsAfterScroll,
    fps,
    worstFrameMs,
    heapMb: heapMb / 1024 / 1024,
    totalRows: ROWS,
  };
}

(window as unknown as { result: Promise<unknown> }).result = measure();

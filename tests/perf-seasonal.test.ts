import { expect, test } from "bun:test";
import { spiderQuip } from "@/lib/spider-quip";

const EVENING = new Date(2026, 9, 28, 19, 40);

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function table(rowCount: number, columnCount: number) {
  const columns = Array.from({ length: columnCount }, (_, index) =>
    index === 0 ? "id" : index === 5 ? "deleted_at" : `col_${index}`,
  );
  const pool = Array.from({ length: 64 }, (_, row) =>
    Object.fromEntries(columns.map((column, index) => [column, (row + index) % 4 ? row : null])),
  );
  return { columns, rows: Array.from({ length: rowCount }, (_, index) => pool[index % 64]) };
}

function measure(columns: string[], rows: Record<string, unknown>[], runs = 300) {
  const durations: number[] = [];
  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    spiderQuip(columns, rows, run / runs, EVENING);
    durations.push(performance.now() - start);
  }
  return { median: percentile(durations, 0.5), p95: percentile(durations, 0.95) };
}

test("Spinnenspruch liest nur eine begrenzte Stichprobe großer Ergebnisse", () => {
  const huge = table(1_000_000, 2_000);
  let highestRow = -1;
  const guarded = new Proxy(huge.rows, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key))
        highestRow = Math.max(highestRow, Number(key));
      return Reflect.get(target, key, receiver);
    },
  });
  spiderQuip(huge.columns, guarded, 0.5, EVENING);
  expect(highestRow).toBe(99);
});

test("Spinnenspruch bleibt bei 1 Mio. Zeilen × 2.000 Spalten unter einer Millisekunde", () => {
  const small = table(1_000, 30);
  const huge = table(1_000_000, 2_000);
  measure(huge.columns, huge.rows, 30);
  const base = measure(small.columns, small.rows);
  const large = measure(huge.columns, huge.rows);
  console.log(
    `seasonal-spider-quip: 1k×30 median ${base.median.toFixed(3)} ms p95 ${base.p95.toFixed(3)} ms; 1M×2000 median ${large.median.toFixed(3)} ms p95 ${large.p95.toFixed(3)} ms`,
  );
  expect(large.p95).toBeLessThan(1);
  expect(large.median).toBeLessThan(0.5);
});

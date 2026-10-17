import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import {
  isRowsWindowJump,
  ROWS_WINDOW_MAX_EXTENT,
  ROWS_WINDOW_MAX_FETCHES,
  rowsWindowExtent,
  rowsWindowFetches,
  rowsWindowRange,
  rowsWindowRun,
} from "../src/lib/rows-window";

const PAGE = 100;
const VIEWPORT = 28;
const TOTAL = 10_000_000;

function scroll(positions: number[], latencyFrames: number, settleFrames = 7) {
  const loaded = new Set<number>();
  const inflight = new Map<number, number>();
  const fetched: number[] = [];
  let range = rowsWindowRange(positions[0], positions[0] + VIEWPORT, PAGE, TOTAL);
  let pendingJump: { range: typeof range; at: number } | null = null;
  let maxInflight = 0;
  let maxWindowRows = 0;
  let placeholderFrames = 0;
  positions.forEach((first, frame) => {
    for (const [page, done] of inflight)
      if (done <= frame) {
        inflight.delete(page);
        loaded.add(page);
      }
    const next = rowsWindowRange(first, first + VIEWPORT, PAGE, TOTAL);
    if (isRowsWindowJump(range, next)) pendingJump = { range: next, at: frame };
    else {
      range = next;
      pendingJump = null;
    }
    if (pendingJump && frame - pendingJump.at >= settleFrames) {
      range = pendingJump.range;
      pendingJump = null;
    }
    for (const page of rowsWindowFetches(range, (page) => loaded.has(page)))
      if (!inflight.has(page)) {
        inflight.set(page, frame + latencyFrames);
        fetched.push(page);
      }
    const active = [...inflight.keys()].filter((page) => page >= range.first && page <= range.last);
    maxInflight = Math.max(maxInflight, active.length);
    const run = rowsWindowRun(range, (page) => loaded.has(page));
    if (run) maxWindowRows = Math.max(maxWindowRows, (run.end - run.start + 1) * PAGE);
    const top = Math.floor(first / PAGE);
    const bottom = Math.floor((first + VIEWPORT) / PAGE);
    if (!loaded.has(top) || !loaded.has(bottom)) placeholderFrames++;
  });
  return { fetched, maxInflight, maxWindowRows, placeholderFrames };
}

test("Wheel-Scrollen durch 10 Mio. Zeilen lädt jede Seite einmal, rechtzeitig und mit begrenztem Fenster", async () => {
  const frames = 6000;
  const positions = Array.from({ length: frames }, (_, frame) => 9_000_000 + frame * 3);
  const result = scroll(positions, 12);
  const scrolledPages = Math.floor((positions.at(-1)! + VIEWPORT) / PAGE) - positions[0] / PAGE + 1;
  expect(new Set(result.fetched).size).toBe(result.fetched.length);
  expect(result.fetched.length).toBeLessThanOrEqual(scrolledPages + 2);
  expect(result.maxInflight).toBeLessThanOrEqual(ROWS_WINDOW_MAX_FETCHES);
  expect(result.maxWindowRows).toBeLessThanOrEqual(4 * PAGE);
  expect(result.placeholderFrames).toBeLessThanOrEqual(12);
  const timing = await measureScenario(() => {
    scroll(positions, 12);
  });
  await reportScenario("rows-window-wheel-scroll", {
    ...timing,
    frames,
    sourceRows: TOTAL,
    fetches: result.fetched.length,
    scrolledPages,
    maxInflight: result.maxInflight,
    maxWindowRows: result.maxWindowRows,
    placeholderFrames: result.placeholderFrames,
    perFrameMs: timing.medianMs / frames,
  });
  expect(timing.p95Ms / frames).toBeLessThan(0.05);
});

test("Schneller Fling bleibt bei zwei parallelen Anfragen und hält nur das sichtbare Fenster", () => {
  const positions = Array.from({ length: 900 }, (_, frame) => frame * 40);
  const result = scroll(positions, 6);
  expect(result.maxInflight).toBeLessThanOrEqual(ROWS_WINDOW_MAX_FETCHES);
  expect(result.maxWindowRows).toBeLessThanOrEqual(4 * PAGE);
  expect(result.fetched.length).toBeLessThanOrEqual(new Set(result.fetched).size);
  expect(result.fetched.length).toBeLessThan(positions.at(-1)! / PAGE + 4);
});

test("Scrollbar-Ziehen über viele Seiten lädt erst am Ziel und nichts dazwischen", () => {
  const drag = Array.from({ length: 30 }, (_, frame) => frame * 5000);
  const rest = Array.from({ length: 20 }, () => drag.at(-1)!);
  const result = scroll([...drag, ...rest], 3);
  const target = Math.floor(drag.at(-1)! / PAGE);
  expect(result.fetched.filter((page) => page > 1 && Math.abs(page - target) > 1)).toEqual([]);
  expect(result.fetched.length).toBeLessThanOrEqual(4);
});

test("Ohne Scrollen bleibt das Fenster ruhig und stellt keine weiteren Anfragen", () => {
  const result = scroll(
    Array.from({ length: 600 }, () => 4200),
    3,
  );
  expect(result.fetched).toEqual([42, 41]);
  expect(result.placeholderFrames).toBeLessThanOrEqual(3);
});

test("Fensterbereich endet an der Tabellengrenze und die Scrollhöhe wächst nur seitenweise", () => {
  expect(rowsWindowRange(970, 998, PAGE, 1000)).toEqual({ first: 9, last: 9, center: 9 });
  expect(rowsWindowRange(0, 28, PAGE)).toEqual({ first: 0, last: 0, center: 0 });
  expect(rowsWindowRange(60, 88, 10).last - rowsWindowRange(60, 88, 10).first).toBeLessThan(10);
  expect(rowsWindowExtent(PAGE, 3, undefined, undefined)).toBe(500);
  expect(rowsWindowExtent(PAGE, 3, 12_345, undefined)).toBe(12_345);
  expect(rowsWindowExtent(PAGE, 3, ROWS_WINDOW_MAX_EXTENT + 1, undefined)).toBe(500);
  expect(rowsWindowExtent(PAGE, 3, undefined, 337)).toBe(337);
  expect(
    rowsWindowRun({ first: 2, last: 6, center: 4 }, (page) => page !== 2 && page !== 5),
  ).toEqual({
    start: 3,
    end: 4,
  });
  expect([...rowsWindowFetches({ first: 0, last: 8, center: 0 }, () => false)]).toEqual([0, 1]);
  expect(rowsWindowRun({ first: 3, last: 5, center: 5 }, (page) => page !== 4)).toEqual({
    start: 5,
    end: 5,
  });
  expect(rowsWindowExtent(PAGE, 3, undefined, undefined, 90_000)).toBe(90_000);
  expect(rowsWindowExtent(PAGE, 3, undefined, 337, 90_000)).toBe(337);
});

import { describe, expect, test } from "bun:test";
import { Virtualizer } from "@tanstack/react-virtual";
import { applyResultView } from "../src/lib/result-grid";
import { runGridSearch } from "../src/lib/grid-search";

const VIEWPORT_HEIGHT = 600;
const ROW_HEIGHT = 33;

function virtualizer(count: number, scrollOffset = 0) {
  const instance = new Virtualizer<Element, Element>({
    count,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getScrollElement: () => ({}) as Element,
    scrollToFn: () => undefined,
    observeElementRect: (_instance, cb) => {
      cb({ width: 800, height: VIEWPORT_HEIGHT });
      return () => undefined;
    },
    observeElementOffset: (_instance, cb) => {
      cb(scrollOffset, false);
      return () => undefined;
    },
  });
  instance._didMount();
  instance._willUpdate();
  return instance;
}

function rows(count: number, columns: string[]) {
  return Array.from({ length: count }, (_, row) => {
    const record: Record<string, unknown> = {};
    for (const [index, column] of columns.entries()) {
      const n = row * 7 + index;
      record[column] =
        n % 4 === 0 ? null : n % 4 === 1 ? n : n % 4 === 2 ? { nested: n } : `text ${n}`;
    }
    return record;
  });
}

describe("Ressourcenbudget: virtualisierte Tabellen", () => {
  test("rendert bei 100.000 Zeilen nur den sichtbaren Ausschnitt plus Overscan", () => {
    const items = virtualizer(100_000).getVirtualItems();
    const visible = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT);
    expect(items.length).toBeGreaterThanOrEqual(visible);
    expect(items.length).toBeLessThanOrEqual(visible + 2 * 10 + 1);
  });

  test("bleibt beim Scrollen ans Ende beim gleichen Fenster", () => {
    const total = 100_000 * ROW_HEIGHT;
    const items = virtualizer(100_000, total - VIEWPORT_HEIGHT).getVirtualItems();
    expect(items.length).toBeLessThanOrEqual(Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + 2 * 10 + 1);
    expect(items.at(-1)?.index).toBe(99_999);
  });

  test("Gesamthöhe deckt alle Zeilen ab", () => {
    expect(virtualizer(100_000).getTotalSize()).toBe(100_000 * ROW_HEIGHT);
  });
});

describe("Performancebudget: Grid-Suche", () => {
  const columns = Array.from({ length: 20 }, (_, i) => `col_${i}`);
  const data = rows(5000, columns);

  test("Textsuche über 5.000 × 20 Zellen bleibt unter 250 ms", () => {
    const start = performance.now();
    const result = runGridSearch(data, columns, "text 7");
    const elapsed = performance.now() - start;
    expect(result.error).toBeNull();
    expect(result.matches.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(250);
  });

  test("Regex-Suche über 5.000 × 20 Zellen bleibt unter 400 ms", () => {
    const start = performance.now();
    const result = runGridSearch(data, columns, "^text \\d+1$", { regex: true });
    const elapsed = performance.now() - start;
    expect(result.error).toBeNull();
    expect(result.matches.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(400);
  });
});

test("lokale Textsortierung über 20.000 Zeilen bleibt unter 250 ms", () => {
  const rows = Array.from({ length: 20_000 }, (_, i) => ({
    name: `Eintrag ${((i * 7919) % 20000).toString(36)}`,
  }));
  const start = performance.now();
  const sorted = applyResultView(rows, ["name"], [{ column: "name", direction: "asc" }], {});
  expect(performance.now() - start).toBeLessThan(250);
  expect(sorted).toHaveLength(rows.length);
  expect(sorted).not.toBe(rows);
  expect(sorted[0].name).toBe("Eintrag 0");
});

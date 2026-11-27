import { afterAll, beforeAll, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CsvMappingTable } from "../src/features/import/csv-mapping-table";

const browserWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
beforeAll(() => {
  Reflect.deleteProperty(globalThis, "window");
});
afterAll(() => {
  if (browserWindow) Object.defineProperty(globalThis, "window", browserWindow);
});

test("120 CSV-Quellspalten erzeugen nur Optionen für ihr ausgewähltes Ziel", () => {
  const headers = Array.from({ length: 120 }, (_, i) => `c${i}`);
  let hintReads = 0;
  const targets = headers.map((name) => ({
    name,
    get data_type() {
      hintReads++;
      return "text";
    },
    is_nullable: true,
    has_default: false,
    is_generated: false,
    is_identity: false,
  }));
  const mappings = headers.map((target, csvIndex) => ({
    csvIndex,
    target: csvIndex === 119 ? null : target,
  }));
  const times: number[] = [];
  for (let run = 0; run < 12; run++) {
    hintReads = 0;
    const start = performance.now();
    const html = renderToStaticMarkup(
      <CsvMappingTable
        headers={headers}
        targets={targets}
        mappings={mappings}
        sampleRow={undefined}
        onChange={() => {}}
      />,
    );
    if (run) times.push(performance.now() - start);
    expect(html.match(/role="combobox"/g)?.length).toBe(20);
    expect(hintReads).toBeLessThanOrEqual(40);
  }
  times.sort((a, b) => a - b);
  console.log(
    `CSV-Zuordnung: Median ${times[5].toFixed(2)} ms, p95 ${times[10].toFixed(2)} ms, ${hintReads} Typzugriffe`,
  );
  expect(times[5]).toBeLessThan(45);
  expect(times[10]).toBeLessThan(100);
});

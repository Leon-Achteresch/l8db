import { expect, test } from "bun:test";
import { selectionRangesWithoutIndent } from "../src/lib/monaco/selection-ranges";

const linesOf = (text: string[]) => ({
  getLineFirstNonWhitespaceColumn: (line: number) => {
    const index = text[line - 1].search(/\S/);
    return index === -1 ? 0 : index + 1;
  },
  getLineMaxColumn: (line: number) => text[line - 1].length + 1,
});

test("mehrzeilige Auswahl lässt führende Leerzeichen und Leerzeilen aus", () => {
  const lines = linesOf(["begin", "  if a then", "   ", "", "    null;", "end;"]);
  const ranges = selectionRangesWithoutIndent(
    lines,
    [{ startLineNumber: 1, startColumn: 3, endLineNumber: 5, endColumn: 3 }],
    [{ startLineNumber: 1, endLineNumber: 6 }],
  );
  expect(ranges).toEqual([
    { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 6 },
    { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 12 },
  ]);
});

test("einzeilige Auswahl bleibt unverändert, auch über Leerzeichen", () => {
  const lines = linesOf(["    x"]);
  expect(
    selectionRangesWithoutIndent(
      lines,
      [
        { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
        { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 2 },
      ],
      [{ startLineNumber: 1, endLineNumber: 1 }],
    ),
  ).toEqual([{ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 }]);
});

test("Alles auswählen in 1.000.000 Zeilen erzeugt nur Bereiche für sichtbare Zeilen", () => {
  const text = Array.from({ length: 1_000_000 }, (_, i) => `  select ${i};`);
  const lines = linesOf(text);
  const selection = [
    { startLineNumber: 1, startColumn: 1, endLineNumber: text.length, endColumn: 12 },
  ];
  const visible = [{ startLineNumber: 500_000, endLineNumber: 500_080 }];
  const durations: number[] = [];
  let count = 0;
  for (let run = 0; run < 200; run++) {
    const started = performance.now();
    count = selectionRangesWithoutIndent(lines, selection, visible).length;
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  const median = durations[100];
  const p95 = durations[190];
  console.log(
    `selection ranges: ${count} Bereiche, median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`,
  );
  expect(count).toBe(81);
  expect(p95).toBeLessThan(2);
});

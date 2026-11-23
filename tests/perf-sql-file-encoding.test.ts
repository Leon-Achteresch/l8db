import { expect, test } from "bun:test";
import { decodeSqlFile, MAX_SQL_FILE_BYTES } from "../src/lib/sql-file";

test("decodes a near-limit SQL file in one bounded pass", () => {
  const line = "SELECT 'Grüße € 東京 🧪';\r\n";
  const rows = Math.floor(MAX_SQL_FILE_BYTES / (line.length * 2));
  const input = Buffer.from(line.repeat(rows), "utf16le");
  const durations: number[] = [];
  for (let run = 0; run < 11; run++) {
    const start = performance.now();
    const output = decodeSqlFile(input, "utf-16le");
    const elapsed = performance.now() - start;
    expect(output.text.length).toBe(input.byteLength / 2);
    expect(output.text.slice(-line.length)).toBe(line);
    if (run >= 2) durations.push(elapsed);
  }
  durations.sort((a, b) => a - b);
  const median = durations[4];
  const p95 = durations[8];
  console.log(
    `A24 decoder: ${input.byteLength} bytes, 9 samples, median=${median.toFixed(2)}ms p95=${p95.toFixed(2)}ms`,
  );
  expect(median).toBeLessThan(70);
  expect(p95).toBeLessThan(150);
});

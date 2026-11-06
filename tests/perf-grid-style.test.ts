import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { getColumnTypeInfo } from "../src/features/table/data-table/column-type-info";
import { buildGridStyle } from "../src/features/table/data-table/use-grid-style";
import type { DetailedColumnInfo } from "../src/lib/db";

const ROWS = 5_000;
const COLUMNS = 400;

function fixture() {
  const names = Array.from({ length: COLUMNS }, (_, index) =>
    index === 0 ? "id" : index % 4 === 1 ? `ref_${index}_id` : `col_${index}`,
  );
  const details = names.map(
    (name, index) =>
      ({
        name,
        data_type: ["text", "", "integer", "timestamp"][index % 4],
        is_primary_key: index === 0,
      }) as DetailedColumnInfo,
  );
  details[0].data_type = "bigint";
  const rows = Array.from({ length: ROWS }, (_, row) => {
    const record: Record<string, unknown> = {};
    for (let index = 0; index < COLUMNS; index++) {
      const kind = index % 4;
      record[names[index]] =
        index === 0
          ? row
          : kind === 1
            ? String(row * 7)
            : kind === 2
              ? row * 3
              : kind === 3
                ? "2026-11-05T10:00:00Z"
                : `value ${row % 9}`;
    }
    return record;
  });
  const typeInfo = new Map(
    names.map((name, index) => [name, getColumnTypeInfo(name, rows, details[index])]),
  );
  return { names, details, rows, typeInfo };
}

test("grid style for 5,000 rows × 400 columns avoids per-column value copies", async () => {
  const { names, details, rows, typeInfo } = fixture();
  for (const style of ["classic", "semantic"] as const) {
    let result = buildGridStyle(style, names, rows, details, typeInfo);
    const timing = await measureScenario(() => {
      result = buildGridStyle(style, names, rows, details, typeInfo);
    });
    expect(result.columns.size).toBe(COLUMNS);
    expect(result.columns.get("id")?.numeric).toBe(true);
    expect(result.columns.get("ref_1_id")?.numeric).toBe(true);
    expect(result.columns.get("col_2")?.numeric).toBe(true);
    expect(result.columns.get("col_4")?.numeric).toBe(false);
    expect(timing.p95Ms).toBeLessThan(200);
    await reportScenario(`grid-style-${style}`, {
      ...timing,
      rows: ROWS,
      columns: COLUMNS,
      databaseRequests: 0,
      limits: { p95Ms: 200 },
    });
  }
});

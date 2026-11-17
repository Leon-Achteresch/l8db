import { afterEach, expect, test } from "bun:test";
import { changedRowValues, toCellDraft, valueToUpdateText } from "../src/lib/cell-editor";
import { contentColumnWidth } from "../src/lib/column-content-width";
import { DEFAULT_CSV_OPTIONS, serializeCsv } from "../src/lib/export";
import {
  isNumericDisplayType,
  MAX_NUMBER_DISPLAY_CHARACTERS,
  normalizeNumberDisplay,
  numberCellText,
  RAW_NUMBER_DISPLAY,
} from "../src/lib/number-display";
import { useQueryQolSettings } from "../src/lib/query-qol-settings";
import { resultColumnWidths } from "../src/lib/result-column-sizing";
import { applyResultView } from "../src/lib/result-grid";
import { compileSingleCondition } from "../src/lib/sql-filter";

const grouped = { mode: "grouped", minimumFractionDigits: 0 } as const;
const format = (value: unknown, minimumFractionDigits: 0 | 2 | 4 = 0) =>
  numberCellText(value, { ...grouped, minimumFractionDigits }, "numeric(65,30)");
afterEach(() => useQueryQolSettings.getState().setNumbers(RAW_NUMBER_DISPLAY));

test("integer and decimal digit strings stay exact beyond 2^53 without rounding or lost scale", () => {
  expect(format("9007199254740993")).toBe("9\u202f007\u202f199\u202f254\u202f740\u202f993");
  expect(format("-12345678901234567890.1234567890123456789000")).toBe(
    "-12\u202f345\u202f678\u202f901\u202f234\u202f567\u202f890.1234567890123456789000",
  );
  expect(format("+001234.00500")).toBe("+001\u202f234.00500");
  expect(format("1234.1234567890123456789", 2)).toBe("1\u202f234.1234567890123456789");
});

test("minimum fractions only add zeroes, including zero, negative zero and fractional inputs", () => {
  expect(format("1234", 2)).toBe("1\u202f234.00");
  expect(format("-0.000", 2)).toBe("-0.000");
  expect(format(".5", 4)).toBe("0.5000");
  expect(format("1234.")).toBe("1\u202f234.");
  expect(numberCellText(-0, { ...grouped, minimumFractionDigits: 2 })).toBe("-0.00");
  expect(numberCellText(1234.125, grouped)).toBe("1\u202f234.125");
});

test("exponents stay unexpanded and all source lexemes survive", () => {
  expect(format("1234567.89000E-123456")).toBe("1\u202f234\u202f567.89000E-123456");
  expect(format("1e+1000000000", 2)).toBe("1.00e+1000000000");
  expect(format("-0e-30")).toBe("-0e-30");
});

test("only actual numeric type metadata allows strings; text IDs and special/unknown values stay raw", () => {
  for (const type of [
    "bigint",
    "int8",
    "NUMERIC(65,30)",
    "numeric(10,-2)",
    "number(38,2)",
    "decimal(12,4) unsigned",
    "LowCardinality(Nullable(Decimal128(20)))",
    "UInt256",
    "money",
    "double precision",
    "binary_double",
  ])
    expect(isNumericDisplayType(type)).toBe(true);
  for (const type of [
    undefined,
    "text",
    "varchar(100)",
    "rowversion",
    "timestamp",
    "boolean",
    "bit",
    "integer[]",
    "Array(Int64)",
    "json",
    "enum('1234')",
    "interval",
    "point",
    "oid",
  ]) {
    expect(isNumericDisplayType(type)).toBe(false);
    expect(numberCellText("12345678", grouped, type)).toBeNull();
  }
  for (const value of [
    null,
    undefined,
    false,
    true,
    {},
    [1234],
    NaN,
    Infinity,
    -Infinity,
    "",
    " ",
    " 1234 ",
    "NULL",
    "NaN",
    "$1,234.50",
    "1,234.5",
    "12_345",
    "123abc",
  ])
    expect(format(value)).toBeNull();
  expect(numberCellText(1234, grouped, "text")).toBeNull();
  expect(numberCellText("1234", RAW_NUMBER_DISPLAY, "numeric")).toBeNull();
});

test("large or malformed inputs have a bounded unchanged fallback", () => {
  const maximum = "9".repeat(MAX_NUMBER_DISPLAY_CHARACTERS);
  expect(format(maximum)?.replaceAll("\u202f", "")).toBe(maximum);
  expect(format(maximum)?.length).toBeLessThan(MAX_NUMBER_DISPLAY_CHARACTERS * 2);
  expect(format(`${maximum}9`)).toBeNull();
  expect(
    numberCellText("1", { mode: "grouped", minimumFractionDigits: 1000000 } as never, "numeric"),
  ).toBe("1");
});

test("existing store keeps old formats backward compatible and sanitizes the additive display option", () => {
  const store = useQueryQolSettings;
  const merge = store.persist.getOptions().merge;
  if (!merge) throw Error("missing real persist merge");
  expect(store.persist.getOptions().version).toBe(1);
  const old = merge(
    { timestamps: { mode: "utc", precision: "milliseconds" }, notifications: true },
    store.getState(),
  );
  expect(old.numbers).toEqual(RAW_NUMBER_DISPLAY);
  expect(old.timestamps.mode).toBe("utc");
  expect(old.notifications).toBe(true);
  store.getState().setNumbers({ mode: "grouped", minimumFractionDigits: 4 });
  const partialize = store.persist.getOptions().partialize;
  if (!partialize) throw Error("missing partialize");
  const payload = JSON.parse(JSON.stringify(partialize(store.getState())));
  expect(merge(payload, store.getState()).numbers).toEqual({
    mode: "grouped",
    minimumFractionDigits: 4,
  });
  for (const value of [undefined, null, "grouped", { mode: "currency", minimumFractionDigits: -2 }])
    expect(normalizeNumberDisplay(value)).toEqual(RAW_NUMBER_DISPLAY);
  expect(
    merge({ numbers: { mode: "grouped", minimumFractionDigits: 5000000 } }, store.getState())
      .numbers,
  ).toEqual(grouped);
});

test("copy/export/edit/filter/sort still receive unchanged frozen source values across option changes", () => {
  const row = Object.freeze({ amount: "9007199254740993.1234500", id: "001234" });
  const rows = [row, Object.freeze({ amount: "1234.5", id: "000001" })];
  const before = {
    csv: serializeCsv(["amount", "id"], rows, DEFAULT_CSV_OPTIONS),
    copy: valueToUpdateText(row.amount),
    edit: toCellDraft(row.amount),
    filter: compileSingleCondition("amount", "eq", row.amount, "postgres", "numeric"),
    sorted: applyResultView(rows, ["amount"], [{ column: "amount", direction: "asc" }], {}),
  };
  useQueryQolSettings.getState().setNumbers({ mode: "grouped", minimumFractionDigits: 4 });
  expect(format(row.amount)).not.toBe(row.amount);
  expect(serializeCsv(["amount", "id"], rows, DEFAULT_CSV_OPTIONS)).toBe(before.csv);
  expect(before.csv).not.toContain("\u202f");
  expect(valueToUpdateText(row.amount)).toBe(before.copy);
  expect(toCellDraft(row.amount)).toEqual(before.edit);
  expect(compileSingleCondition("amount", "eq", row.amount, "postgres", "numeric")).toBe(
    before.filter,
  );
  expect(applyResultView(rows, ["amount"], [{ column: "amount", direction: "asc" }], {})).toEqual(
    before.sorted,
  );
  expect(changedRowValues({ amount: row.amount }, row).updates).toEqual({});
  expect(row.amount).toBe("9007199254740993.1234500");
});

test("existing content-width paths include formatted text without modifying sample rows", () => {
  const base = {
    name: "v",
    hasFk: false,
    kind: "number" as const,
    categorical: false,
    values: ["123456789012345"],
    style: "compact" as const,
    uiScale: 100,
  };
  expect(contentColumnWidth({ ...base, displayText: (value) => format(value) })).toBeGreaterThan(
    contentColumnWidth(base),
  );
  const opts = { mode: "raw", precision: "seconds" } as const;
  const rows = [{ v: 123456789012345 }];
  const measure = (text: string) => text.length * 7;
  expect(resultColumnWidths(["v"], rows, measure, true, opts, grouped).v).toBeGreaterThan(
    resultColumnWidths(["v"], rows, measure, true, opts).v,
  );
  const exact = [{ v: "123456789012345" }];
  expect(resultColumnWidths(["v"], exact, measure, true, opts, grouped)).toEqual(
    resultColumnWidths(["v"], exact, measure, true, opts),
  );
});

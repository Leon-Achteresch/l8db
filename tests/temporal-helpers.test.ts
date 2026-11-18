import { describe, expect, test } from "bun:test";
import { cellEditCommitValue } from "../src/features/table/data-table/use-cell-editing";
import {
  formatTemporal,
  resolveTemporalShortcut,
  temporalHelpers,
  temporalKind,
} from "../src/lib/temporal-helpers";

const now = new Date(2026, 10, 18, 9, 5, 7, 42);

function offset(date: Date) {
  const minutes = -date.getTimezoneOffset();
  const abs = Math.abs(minutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

describe("temporalKind", () => {
  test.each([
    ["timestamp with time zone", undefined, "datetimetz"],
    ["timestamptz", undefined, "datetimetz"],
    ["TIMESTAMP(6) WITH TIME ZONE", "oracle", "datetimetz"],
    ["TIMESTAMP(6) WITH LOCAL TIME ZONE", "oracle", "datetime"],
    ["timestamp without time zone", undefined, "datetime"],
    ["timestamp(3)", undefined, "datetime"],
    ["datetime", "mysql", "datetime"],
    ["datetime2", "mssql", "datetime"],
    ["smalldatetime", "mssql", "datetime"],
    ["datetimeoffset", "mssql", "datetimetz"],
    ["Nullable(DateTime64(3, 'UTC'))", "clickhouse", "datetime"],
    ["Nullable(Date)", "clickhouse", "date"],
    ["Date32", "clickhouse", "date"],
    ["date", "postgres", "date"],
    ["DATE", "oracle", "datetime"],
    ["time without time zone", undefined, "time"],
    ["time(6) with time zone", undefined, "timetz"],
    ["timetz", undefined, "timetz"],
  ] as const)("%s (%s) → %s", (dataType, kind, expected) => {
    expect(temporalKind(dataType, kind)).toBe(expected);
  });

  test.each([
    "interval",
    "interval day to second",
    "timestamp[]",
    "Array(DateTime)",
    "text",
    "integer",
    "year",
    "",
  ])("%s has no helpers", (dataType) => {
    expect(temporalKind(dataType)).toBeNull();
  });

  test("missing type has no helpers", () => {
    expect(temporalKind(undefined)).toBeNull();
    expect(temporalKind(null)).toBeNull();
  });
});

describe("formatTemporal", () => {
  test("formats each kind as a literal every SQL family accepts", () => {
    expect(formatTemporal(now, "date")).toBe("2026-11-18");
    expect(formatTemporal(now, "datetime")).toBe("2026-11-18 09:05:07");
    expect(formatTemporal(now, "datetimetz")).toBe(`2026-11-18 09:05:07.042 ${offset(now)}`);
    expect(formatTemporal(now, "time")).toBe("09:05:07");
    expect(formatTemporal(now, "timetz")).toBe(`09:05:07${offset(now)}`);
  });
});

describe("temporalHelpers", () => {
  test("date columns get calendar helpers", () => {
    const helpers = temporalHelpers("date");
    expect(helpers.map((h) => h.label)).toEqual([
      "Jetzt",
      "Heute",
      "Gestern",
      "Morgen",
      "Monatsanfang",
    ]);
    expect(Object.fromEntries(helpers.map((h) => [h.id, h.value(now)]))).toEqual({
      now: "2026-11-18",
      today: "2026-11-18",
      yesterday: "2026-11-17",
      tomorrow: "2026-11-19",
      monthStart: "2026-11-01",
    });
  });

  test("timestamp helpers keep the time for now and use midnight for days", () => {
    const values = Object.fromEntries(temporalHelpers("datetime").map((h) => [h.id, h.value(now)]));
    expect(values.now).toBe("2026-11-18 09:05:07");
    expect(values.today).toBe("2026-11-18 00:00:00");
    expect(values.monthStart).toBe("2026-11-01 00:00:00");
  });

  test("day helpers roll over month and year boundaries", () => {
    const newYear = new Date(2027, 0, 1, 12);
    const values = Object.fromEntries(temporalHelpers("date").map((h) => [h.id, h.value(newYear)]));
    expect(values.yesterday).toBe("2026-12-31");
    const lastDay = new Date(2028, 1, 29, 12);
    const leap = Object.fromEntries(temporalHelpers("date").map((h) => [h.id, h.value(lastDay)]));
    expect(leap.tomorrow).toBe("2028-03-01");
  });

  test("time columns only offer now", () => {
    expect(temporalHelpers("time").map((h) => h.id)).toEqual(["now"]);
    expect(temporalHelpers("timetz")[0].value(now)).toBe(`09:05:07${offset(now)}`);
  });
});

describe("resolveTemporalShortcut", () => {
  test.each([
    "now()",
    "NOW()",
    " now ( ) ",
    "current_timestamp",
    "CURRENT_TIMESTAMP()",
    "localtimestamp",
    "sysdate",
    "SYSTIMESTAMP",
    "getdate()",
    "sysdatetime()",
    "sysdatetimeoffset()",
    "datetime('now')",
    "jetzt",
  ])("%s resolves to the current timestamp", (input) => {
    expect(resolveTemporalShortcut(input, "datetime", now)).toBe("2026-11-18 09:05:07");
  });

  test("date shortcuts resolve relative to today", () => {
    expect(resolveTemporalShortcut("current_date", "date", now)).toBe("2026-11-18");
    expect(resolveTemporalShortcut("curdate()", "date", now)).toBe("2026-11-18");
    expect(resolveTemporalShortcut("today", "datetime", now)).toBe("2026-11-18 00:00:00");
    expect(resolveTemporalShortcut("Gestern", "date", now)).toBe("2026-11-17");
    expect(resolveTemporalShortcut("tomorrow", "date", now)).toBe("2026-11-19");
  });

  test("time shortcuts", () => {
    expect(resolveTemporalShortcut("current_time", "time", now)).toBe("09:05:07");
    expect(resolveTemporalShortcut("now()", "timetz", now)).toBe(`09:05:07${offset(now)}`);
    expect(resolveTemporalShortcut("today", "time", now)).toBeNull();
  });

  test("leaves literals and non-temporal columns alone", () => {
    expect(resolveTemporalShortcut("2024-01-01", "date", now)).toBeNull();
    expect(resolveTemporalShortcut("now() - interval '1 day'", "datetime", now)).toBeNull();
    expect(resolveTemporalShortcut("now()", null, now)).toBeNull();
    expect(resolveTemporalShortcut("now()", undefined, now)).toBeNull();
  });
});

describe("cellEditCommitValue with temporal shortcuts", () => {
  const cell = (value: string, temporal: Parameters<typeof temporalHelpers>[0] | null) => ({
    ctid: "(0,1)",
    rowIndex: 0,
    columnId: "created_at",
    value,
    originalValues: { id: 1, created_at: "2020-01-01 00:00:00" },
    temporal,
  });

  test("resolves typed now() in a timestamp cell", () => {
    expect(cellEditCommitValue(cell("now()", "datetime"), undefined, now)).toBe(
      "2026-11-18 09:05:07",
    );
  });

  test("keeps now() as text in a text cell", () => {
    expect(cellEditCommitValue(cell("now()", null), undefined, now)).toBe("now()");
  });

  test("keeps literal timestamps and NULL handling unchanged", () => {
    expect(cellEditCommitValue(cell("2024-02-03 04:05:06", "datetime"), undefined, now)).toBe(
      "2024-02-03 04:05:06",
    );
    expect(cellEditCommitValue(cell("", "datetime"), undefined, now)).toBeNull();
  });
});

describe("temporal shortcut throughput", () => {
  test("resolving 100k committed values stays cheap", () => {
    const inputs = ["now()", "2024-01-01 10:00:00", "current_date", "abc", ""];
    const samples: number[] = [];
    for (let round = 0; round < 7; round++) {
      const started = performance.now();
      for (let i = 0; i < 100_000; i++)
        resolveTemporalShortcut(inputs[i % inputs.length], "datetimetz", now);
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    console.log(`resolve 100k ms: median ${samples[3].toFixed(1)}, max ${samples[6].toFixed(1)}`);
    expect(samples[3]).toBeLessThan(250);
  });
});

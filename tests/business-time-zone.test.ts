import { expect, test } from "bun:test";
import {
  normalizeBusinessTimeZone,
  normalizeTimestampOptions,
  supportsBusinessTimestamp,
  type TimestampOptions,
  timestampCellText,
} from "../src/lib/timestamp-display";

const options: TimestampOptions = {
  mode: "business",
  timeZone: "America/New_York",
  precision: "seconds",
};
const render = (raw: unknown) =>
  timestampCellText(raw, options, "postgres", "timestamp(6) with time zone");

test("formats both sides of DST transitions and keeps all recorded fractional digits", () => {
  expect(render("2026-03-08T06:59:59.123456+00:00")).toBe("2026-03-08 01:59:59.123456 -05:00");
  expect(render("2026-03-08T07:00:00.234560+00:00")).toBe("2026-03-08 03:00:00.234560 -04:00");
  expect(render("2026-11-01T05:30:00.999999Z")).toBe("2026-11-01 01:30:00.999999 -04:00");
  expect(render("2026-11-01T06:30:00.000001Z")).toBe("2026-11-01 01:30:00.000001 -05:00");
  expect(render("2026-03-08 01:30:00-05")).toBe("2026-03-08 01:30:00 -05:00");
  expect(
    timestampCellText(
      "2026-03-08T18:30:00.100000Z",
      { ...options, timeZone: "Asia/Kolkata" },
      "postgres",
      "timestamptz",
    ),
  ).toBe("2026-03-09 00:00:00.100000 +05:30");
});

test("requires typed PostgreSQL timezone metadata and a well-formed offset", () => {
  const raw = "2026-11-01T06:30:00.000001Z";
  expect(supportsBusinessTimestamp("postgres", " TIMESTAMPTZ(6) ")).toBe(true);
  expect(supportsBusinessTimestamp("postgres", "timestamptz[]")).toBe(false);
  expect(supportsBusinessTimestamp("postgres", "timestamp without time zone")).toBe(false);
  expect(supportsBusinessTimestamp("postgres", "time with time zone")).toBe(false);
  expect(supportsBusinessTimestamp("mssql", "timestamp")).toBe(false);
  expect(timestampCellText(raw, options, "mssql", "datetimeoffset")).toBe(raw);
  expect(timestampCellText(raw, options, "mysql", "timestamp with time zone")).toBe(raw);
  expect(timestampCellText(raw, options, "postgres", "text")).toBe(raw);
  expect(timestampCellText(raw, options)).toBe(raw);
  expect(render("2026-11-01 01:30:00")).toBe("2026-11-01 01:30:00");
  expect(render("2026-02-30T01:30:00Z")).toBe("2026-02-30T01:30:00Z");
  expect(render("2026-11-01T24:00:00Z")).toBe("2026-11-01T24:00:00Z");
  expect(render("2026-11-01T01:30:00+25")).toBe("2026-11-01T01:30:00+25");
  expect(render(null)).toBeNull();
});

test("normalizes persisted modes and accepts only named runtime zones", () => {
  expect(normalizeBusinessTimeZone(" Europe/Berlin ")).toBe("Europe/Berlin");
  expect(normalizeBusinessTimeZone("UTC")).toBeDefined();
  for (const zone of ["Mars/Olympus", "+01:00", "01:00", "", "x".repeat(100), null]) {
    expect(normalizeBusinessTimeZone(zone)).toBeUndefined();
  }
  expect(normalizeTimestampOptions()).toEqual({ mode: "raw", precision: "seconds" });
  expect(normalizeTimestampOptions({ mode: "local", precision: "milliseconds" })).toEqual({
    mode: "local",
    precision: "milliseconds",
  });
  expect(normalizeTimestampOptions({ ...options, timeZone: "Mars/Olympus" })).toEqual({
    mode: "raw",
    precision: "seconds",
  });
  expect(normalizeTimestampOptions({ ...options, mode: "raw" })).toEqual({
    ...options,
    mode: "raw",
  });
  expect(
    timestampCellText(
      "2026-03-08T06:59:59.123456Z",
      { ...options, timeZone: "Mars/Olympus" },
      "postgres",
      "timestamptz",
    ),
  ).toBe("2026-03-08T06:59:59.123456Z");
});

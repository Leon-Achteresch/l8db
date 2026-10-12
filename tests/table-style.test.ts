import { expect, test } from "bun:test";
import {
  CONTENT_COLUMN_MAX,
  CONTENT_COLUMN_MIN,
  compactCellText,
  contentColumnWidth,
  PROFILE_COLUMN_MIN,
} from "../src/lib/column-content-width";
import { columnProfile } from "../src/lib/column-profile";
import {
  categoryColorIndex,
  isCategorical,
  isEnumDataType,
  jsonEntries,
  parseDbTimestamp,
  shortUuid,
  splitEmail,
  timestampDisplay,
} from "../src/lib/grid-cell-format";
import { normalizeTableStyle, tableCellPadding, tableRowHeight } from "../src/lib/table-style";

const NOW = new Date("2026-10-08T12:00:00+02:00");

test("unknown table styles fall back to classic", () => {
  expect(normalizeTableStyle("semantic")).toBe("semantic");
  expect(normalizeTableStyle("profile")).toBe("profile");
  expect(normalizeTableStyle("fancy")).toBe("classic");
  expect(normalizeTableStyle(undefined)).toBe("classic");
});

test("classic row heights match the previous density heights", () => {
  expect(tableRowHeight("classic", "compact", 100)).toBe(25);
  expect(tableRowHeight("classic", "normal", 100)).toBe(33);
  expect(tableRowHeight("classic", "spacious", 100)).toBe(41);
  expect(tableRowHeight("classic", "normal", 150)).toBe(49);
});

test("compact styles shrink row padding without going negative", () => {
  expect(tableCellPadding("compact", "normal")).toBe(2);
  expect(tableCellPadding("compact", "compact")).toBe(0);
  expect(tableCellPadding("semantic", "normal")).toBe(4);
  expect(tableRowHeight("compact", "normal", 100)).toBe(25);
  expect(tableRowHeight("semantic", "normal", 100)).toBe(29);
});

test("uuids are shortened only when they are real uuids", () => {
  expect(shortUuid("3f2a91c4-8b1e-4c2a-9f3d-1a2b3c4d5e6f")).toBe("3f2a91c4…5e6f");
  expect(shortUuid("not-a-uuid")).toBe("not-a-uuid");
  expect(compactCellText("3f2a91c4-8b1e-4c2a-9f3d-1a2b3c4d5e6f")).toBe("3f2a91c4…5e6f");
  expect(compactCellText(null)).toBe("NULL");
});

test("emails split into local part and domain", () => {
  expect(splitEmail("anna.schmidt@example.de")).toEqual(["anna.schmidt", "@example.de"]);
  expect(splitEmail("Bitte an der Tür abgeben")).toBeNull();
});

test("database timestamps with short offsets parse in every engine format", () => {
  expect(parseDbTimestamp("2026-10-06 14:02:12.381+02")?.toISOString()).toBe(
    "2026-10-06T12:02:12.381Z",
  );
  expect(parseDbTimestamp("2026-10-06T14:02:12Z")?.toISOString()).toBe("2026-10-06T14:02:12.000Z");
  expect(parseDbTimestamp("2026-10-06 14:02:12+0530")?.toISOString()).toBe(
    "2026-10-06T08:32:12.000Z",
  );
  expect(parseDbTimestamp("gestern")).toBeNull();
});

test("recent timestamps read relative, old ones as dates, both keep the stored time", () => {
  expect(timestampDisplay("2026-10-06 14:02:12+02", NOW)).toEqual({
    primary: "vorgestern",
    secondary: "14:02",
  });
  expect(timestampDisplay("2026-10-08 09:00:00+02", NOW)).toEqual({
    primary: "vor 3 Stunden",
    secondary: "09:00",
  });
  expect(timestampDisplay("2025-03-01 08:15:00+01", NOW)).toEqual({
    primary: "01.03.2025",
    secondary: "08:15",
  });
  expect(timestampDisplay("2026-10-06", NOW)).toEqual({ primary: "06.10.2026", secondary: "" });
});

test("status-like columns are categorical, names and free text are not", () => {
  const statuses = ["paid", "pending", "shipped", "paid", "refunded", "paid", "shipped", null];
  expect(isCategorical(statuses)).toBe(true);
  expect(isCategorical(["EUR", "EUR", "USD", "EUR", "EUR"])).toBe(true);
  const names = ["Schmidt", "Müller", "Weber", "Schmidt", "Müller", "Weber", "Koch", "Koch"];
  expect(isCategorical(names)).toBe(false);
  expect(isCategorical(names, true)).toBe(true);
  expect(isCategorical(["a", "b", "c", "d"])).toBe(false);
  expect(isCategorical([1, 2, 1, 2, 1])).toBe(false);
});

test("enum detection ignores ordinary text and network types", () => {
  expect(isEnumDataType("order_status")).toBe(true);
  expect(isEnumDataType("character varying(255)")).toBe(false);
  expect(isEnumDataType("inet")).toBe(false);
  expect(isEnumDataType(undefined)).toBe(false);
});

test("category colors are stable per value", () => {
  expect(categoryColorIndex("paid")).toBe(categoryColorIndex("paid"));
  expect(categoryColorIndex("paid")).toBeGreaterThanOrEqual(0);
  expect(categoryColorIndex("paid")).toBeLessThan(6);
});

test("json previews list the first keys and summarize nested values", () => {
  expect(jsonEntries({ source: "web", tags: [1, 2], meta: { a: 1 }, extra: true })).toEqual([
    ["source", "web"],
    ["tags", "[2]"],
    ["meta", "{…}"],
  ]);
  expect(jsonEntries([1, 2, 3])).toBeNull();
  expect(jsonEntries({})).toBeNull();
});

test("numeric profiles build a histogram with readable bounds", () => {
  const profile = columnProfile(["9.90", "100", "485.04", null], "number", false, 4);
  expect(profile).toEqual({
    type: "histogram",
    bins: [2, 0, 0, 1],
    min: "9,9",
    max: "485,04",
    nullRatio: 0.25,
  });
});

test("categorical profiles sort parts by frequency", () => {
  const profile = columnProfile(["paid", "shipped", "paid", null], "text", true);
  expect(profile).toEqual({
    type: "categories",
    parts: [
      { value: "paid", count: 2 },
      { value: "shipped", count: 1 },
    ],
    total: 4,
    nullRatio: 0.25,
  });
});

test("boolean, text and empty columns get matching profiles", () => {
  expect(columnProfile([true, false, true, true], "boolean", false)).toEqual({
    type: "boolean",
    trueRatio: 0.75,
    nullRatio: 0,
  });
  expect(columnProfile(["a", "b", "a"], "text", false)).toEqual({
    type: "distinct",
    distinct: 2,
    total: 3,
    nullRatio: 0,
  });
  expect(columnProfile([], "text", false)).toEqual({ type: "empty" });
});

test("date profiles use the timestamp range", () => {
  const profile = columnProfile(
    ["2026-09-01 10:00:00+02", "2026-09-30 10:00:00+02"],
    "date",
    false,
    2,
  );
  expect(profile.type).toBe("histogram");
  if (profile.type === "histogram") expect(profile.bins).toEqual([1, 1]);
});

test("content widths follow the longest value and respect the bounds", () => {
  const base = {
    name: "id",
    hasFk: false,
    kind: "number" as const,
    categorical: false,
    style: "compact" as const,
    uiScale: 100,
    now: NOW,
  };
  const short = contentColumnWidth({ ...base, values: [1, 2, 3] });
  const long = contentColumnWidth({ ...base, values: [1, 1234567890123] });
  expect(short).toBeGreaterThanOrEqual(CONTENT_COLUMN_MIN);
  expect(long).toBeGreaterThan(short);
  expect(contentColumnWidth({ ...base, values: ["x".repeat(400)] })).toBe(CONTENT_COLUMN_MAX);
  expect(contentColumnWidth({ ...base, values: [1], style: "profile" })).toBe(PROFILE_COLUMN_MIN);
  expect(contentColumnWidth({ ...base, values: [1, 1234567890123], uiScale: 150 })).toBe(
    Math.round(long * 1.5),
  );
});

test("compact widths are much narrower than the classic default for short values", () => {
  const width = contentColumnWidth({
    name: "customer_id",
    hasFk: false,
    kind: "number",
    categorical: false,
    values: [500, 537, 612],
    style: "compact",
    uiScale: 100,
    now: NOW,
  });
  expect(width).toBeLessThan(160);
});

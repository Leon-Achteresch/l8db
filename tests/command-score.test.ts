import { expect, test } from "bun:test";
import { commandMatchRanges, commandScore, rankCommands } from "../src/lib/command-score";

test("exakte Präfixtreffer vor Teiltreffern", () => {
  const items = [
    { label: "AUFTRAG_SPED_CONFIG", keywords: ["public", "public.AUFTRAG_SPED_CONFIG"] },
    { label: "SPEDITION_LOG", keywords: ["public"] },
    { label: "SPEDITION", keywords: ["public", "public.SPEDITION"] },
    { label: "XSPEDX" },
    { label: "SOMEPREFIXEDTHING" },
    { label: "KUNDE" },
  ];
  expect(rankCommands(items, "SPED").map((i) => i.label)).toEqual([
    "SPEDITION",
    "SPEDITION_LOG",
    "AUFTRAG_SPED_CONFIG",
    "XSPEDX",
    "SOMEPREFIXEDTHING",
  ]);
});

test("mehrere Suchwörter müssen alle treffen, Reihenfolge egal", () => {
  const items = [
    { label: "ORDERS", keywords: ["public"] },
    { label: "ORDERS", keywords: ["archive"] },
    { label: "KUNDE", keywords: ["public"] },
  ];
  expect(rankCommands(items, "public ord").map((i) => i.keywords[0])).toEqual(["public"]);
  expect(rankCommands(items, "ord xyz")).toEqual([]);
});

test("Fuzzy-Suche findet ausgelassene Buchstaben ohne Beachtung der Großschreibung", () => {
  const items = [{ label: "customers" }, { label: "customer_overview" }, { label: "orders" }];
  expect(rankCommands(items, "  CSMR  ").map((item) => item.label)).toEqual([
    "customers",
    "customer_overview",
  ]);
  expect(rankCommands(items, "smrc")).toEqual([]);
});

test("direkte Treffer stehen vor kompakten und weit gestreuten Fuzzy-Treffern", () => {
  const items = [
    { label: "customer_statistics_report" },
    { label: "c_s_m_r" },
    { label: "CSMR_archive" },
    { label: "CSMR" },
  ];
  expect(rankCommands(items, "csmr").map((item) => item.label)).toEqual([
    "CSMR",
    "CSMR_archive",
    "c_s_m_r",
    "customer_statistics_report",
  ]);
});

test("Fuzzy-Suche kombiniert Namen mit Zusatztext und Keywords", () => {
  const items = [
    { label: "customers", hint: "Tabelle · reporting", keywords: ["shop_prod"] },
    { label: "customers", hint: "Tabelle · archive", keywords: ["shop_prod"] },
  ];
  expect(rankCommands(items, "rpt csmr")).toEqual([items[0]]);
  expect(rankCommands(items, "shop csmr")).toEqual(items);
  expect(commandScore("xyz csmr", items[0])).toBe(0);
  expect(commandScore("csmr", { label: "cs", keywords: ["mr"] })).toBe(0);
});

test("leere Suche erhält die ursprüngliche Reihenfolge", () => {
  const items = [{ label: "orders" }, { label: "customers" }];
  expect(rankCommands(items, "   ")).toBe(items);
});

test("Unterstreichung markiert zusammenhängende und einzelne Fuzzy-Zeichen", () => {
  expect(commandMatchRanges("CUST", "orders.customer_id")).toEqual([{ start: 7, end: 11 }]);
  expect(commandMatchRanges("csmr", "customers")).toEqual([
    { start: 0, end: 1 },
    { start: 2, end: 3 },
    { start: 5, end: 6 },
    { start: 7, end: 8 },
  ]);
  expect(commandMatchRanges("cust customer", "customers")).toEqual([{ start: 0, end: 8 }]);
  expect(commandMatchRanges("public cust", "public.customers")).toEqual([
    { start: 0, end: 6 },
    { start: 7, end: 11 },
  ]);
  expect(commandMatchRanges("cust", "İ_customers")).toEqual([{ start: 2, end: 6 }]);
  expect(commandMatchRanges("ÄND", "Änderungen")).toEqual([{ start: 0, end: 3 }]);
});

test("Unterstreichung verwendet den kompaktesten Fuzzy-Treffer", () => {
  expect(commandMatchRanges("csmr", "c_long_s_long_m_long_r c_s_m_r")).toEqual([
    { start: 23, end: 24 },
    { start: 25, end: 26 },
    { start: 27, end: 28 },
    { start: 29, end: 30 },
  ]);
  expect(commandMatchRanges("", "customers")).toEqual([]);
  expect(commandMatchRanges("xyz", "customers")).toEqual([]);
});

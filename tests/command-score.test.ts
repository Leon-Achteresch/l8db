import { expect, test } from "bun:test";
import { rankCommands } from "../src/lib/command-score";

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

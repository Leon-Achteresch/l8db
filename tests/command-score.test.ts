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

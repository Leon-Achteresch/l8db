import { describe, expect, test } from "bun:test";
import type { CommandItem } from "../src/components/motion/command-palette/types";
import {
  paletteSearchItems,
  parsePaletteQuery,
  withHistory,
} from "../src/lib/command-palette-search";
import { rankCommands } from "../src/lib/command-score";
import { recordPaletteUse } from "../src/lib/palette-history";

const items: CommandItem[] = [
  { id: "table", label: "exports", kind: "object", onSelect: () => {} },
  { id: "connection", label: "Export DB", kind: "connection", onSelect: () => {} },
  { id: "export", label: "Ergebnis exportieren…", kind: "command", onSelect: () => {} },
  { id: "settings", label: "Exportoptionen", kind: "setting", onSelect: () => {} },
  { id: "format", label: "SQL formatieren", kind: "command", onSelect: () => {} },
];

describe("Befehlsmodus der Palette", () => {
  test("erkennt > mit und ohne Leerzeichen und entfernt nur das Präfix", () => {
    expect(parsePaletteQuery(">expo")).toEqual({ commandsOnly: true, search: "expo" });
    expect(parsePaletteQuery("  >  expo")).toEqual({ commandsOnly: true, search: "expo" });
    expect(parsePaletteQuery("> ")).toEqual({ commandsOnly: true, search: "" });
    expect(parsePaletteQuery("price > 10")).toEqual({ commandsOnly: false, search: "price > 10" });
    expect(parsePaletteQuery(">expo", false)).toEqual({ commandsOnly: false, search: ">expo" });
  });

  test("sucht nach Befehlen und Einstellungen ohne Objekte oder Verbindungen", () => {
    const query = parsePaletteQuery("> expo");
    const results = rankCommands(paletteSearchItems(items, query.commandsOnly), query.search);
    expect(results.map((item) => item.id)).toEqual(["settings", "export"]);
    expect(paletteSearchItems(items, false)).toBe(items);
  });

  test("zeigt ohne Eingabe zuletzt und häufig genutzte Einträge einmalig", () => {
    const history = {
      table: { count: 5, last: 1 },
      connection: { count: 3, last: 2 },
      format: { count: 1, last: 4 },
      export: { count: 2, last: 3 },
      missing: { count: 9, last: 9 },
    };
    const results = withHistory(items, history, "");
    expect(results.map((item) => [item.id, item.group])).toEqual([
      ["format", "Zuletzt"],
      ["export", "Zuletzt"],
      ["connection", "Zuletzt"],
      ["table", "Zuletzt"],
      ["settings", undefined],
    ]);
    expect(items[4].group).toBeUndefined();
    expect(withHistory(items, history, "expo")).toBe(items);
    expect(withHistory(items, {}, "")).toBe(items);
  });

  test("trennt Häufig von Zuletzt und begrenzt den Verlauf", () => {
    let history = {};
    for (let i = 0; i < 6; i++) history = recordPaletteUse(history, "table", i);
    for (let i = 0; i < 120; i++) history = recordPaletteUse(history, `x${i}`, 10 + i);
    expect(Object.keys(history)).toHaveLength(100);
    expect(history).not.toHaveProperty("table");
    const recentOnly = {
      a: { count: 1, last: 10 },
      b: { count: 1, last: 9 },
      c: { count: 1, last: 8 },
      d: { count: 1, last: 7 },
      e: { count: 1, last: 6 },
      table: { count: 4, last: 1 },
    };
    const extra = [
      ...items,
      ...["a", "b", "c", "d", "e"].map((id) => ({ id, label: id, onSelect: () => {} })),
    ];
    const grouped = withHistory(extra, recentOnly, "").slice(0, 6);
    expect(grouped.map((item) => [item.id, item.group])).toEqual([
      ["a", "Zuletzt"],
      ["b", "Zuletzt"],
      ["c", "Zuletzt"],
      ["d", "Zuletzt"],
      ["e", "Zuletzt"],
      ["table", "Häufig"],
    ]);
  });
});

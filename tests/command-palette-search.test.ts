import { describe, expect, test } from "bun:test";
import type { CommandItem } from "../src/components/motion/command-palette/types";
import {
  paletteSearchItems,
  parsePaletteQuery,
  withRecentCommands,
} from "../src/lib/command-palette-search";
import { rankCommands } from "../src/lib/command-score";

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

  test("behält aktuelle Befehle einmalig in der Reihenfolge ihrer letzten Nutzung", () => {
    const results = withRecentCommands(items, ["format", "export", "missing", "table"], "");
    expect(results.slice(0, 2).map((item) => item.id)).toEqual(["format", "export"]);
    expect(results.slice(0, 2).every((item) => item.group === "Zuletzt verwendet")).toBe(true);
    expect(results).toHaveLength(items.length);
    expect(items[4].group).toBeUndefined();
    expect(withRecentCommands(items, ["format"], "expo")).toBe(items);
  });
});

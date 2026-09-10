import { describe, expect, test } from "bun:test";
import { groupMatchesByTab, searchQueryTabs } from "../src/lib/tab-search";

const tabs = [
  { id: "a", title: "Query 1", sql: "SELECT * FROM kunde;\nWHERE kunde.id = 1;" },
  { id: "b", title: "Bericht.sql", sql: "-- kein Treffer\nSELECT 1;" },
];

describe("searchQueryTabs", () => {
  test("liefert Tabname, Zeile und Textausschnitt je Treffer", () => {
    const result = searchQueryTabs(tabs, "kunde");
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toMatchObject({
      tabId: "a",
      tabTitle: "Query 1",
      line: 1,
      column: 15,
      length: 5,
    });
    expect(result.matches[0].lineText).toBe("SELECT * FROM kunde;");
    expect(result.matches[1].line).toBe(2);
    expect(
      result.matches[1].preview.slice(
        result.matches[1].previewStart,
        result.matches[1].previewStart + result.matches[1].previewLength,
      ),
    ).toBe("kunde");
  });

  test("ignoriert Groß-/Kleinschreibung nur ohne caseSensitive", () => {
    expect(searchQueryTabs(tabs, "SELECT").matches).toHaveLength(2);
    expect(searchQueryTabs(tabs, "select", { caseSensitive: true }).matches).toHaveLength(0);
  });

  test("wholeWord findet nur ganze Wörter", () => {
    const sources = [{ id: "a", title: "T", sql: "kunde kundennummer" }];
    expect(searchQueryTabs(sources, "kunde").matches).toHaveLength(2);
    expect(searchQueryTabs(sources, "kunde", { wholeWord: true }).matches).toHaveLength(1);
  });

  test("meldet ungültige reguläre Ausdrücke ohne zu werfen", () => {
    const result = searchQueryTabs(tabs, "SELECT(", { regex: true });
    expect(result.invalidPattern).toBe(true);
    expect(result.matches).toHaveLength(0);
  });

  test("regex-Modus findet Muster", () => {
    const result = searchQueryTabs(tabs, "kunde\\.\\w+", { regex: true });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].line).toBe(2);
  });

  test("leerer Suchtext liefert keine Treffer", () => {
    expect(searchQueryTabs(tabs, "   ").matches).toHaveLength(0);
  });

  test("berücksichtigt nur übergebene (offene) Tabs und kürzt bei maxMatches", () => {
    const closed = searchQueryTabs([tabs[1]], "kunde");
    expect(closed.matches).toHaveLength(0);
    const limited = searchQueryTabs(tabs, "SELECT", { maxMatches: 1 });
    expect(limited.matches).toHaveLength(1);
    expect(limited.truncated).toBe(true);
  });

  test("gruppiert Treffer je Tab in Reihenfolge", () => {
    const groups = groupMatchesByTab(searchQueryTabs(tabs, "SELECT").matches);
    expect(groups).toHaveLength(2);
    expect(groups[0].tabId).toBe("a");
    expect(groups[0].matches).toHaveLength(1);
    expect(groups[1].tabId).toBe("b");
    expect(groups[1].matches).toHaveLength(1);
  });
});

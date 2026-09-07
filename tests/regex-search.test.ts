import { describe, expect, test } from "bun:test";

import {
  compileRegexSearch,
  countRegexMatches,
  describeRegexError,
  escapeRegexLiteral,
  insertRegexPattern,
  REGEX_PATTERN_LIBRARY,
  regexLiteralPrefilter,
  regexSearchFlags,
} from "../src/lib/regex-search";

describe("compileRegexSearch", () => {
  test("kompiliert gültige Muster mit Flags", () => {
    const result = compileRegexSearch("\\d+", { caseSensitive: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.flags).toBe("gi");
      expect(result.regex.test("abc 42")).toBe(true);
    }
  });

  test("respektiert Groß-/Kleinschreibung und global:false", () => {
    const result = compileRegexSearch("abc", { caseSensitive: true, global: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.flags).toBe("");
      expect(result.regex.test("ABC")).toBe(false);
    }
  });

  test("meldet leeres Muster", () => {
    const result = compileRegexSearch("");
    expect(result.ok).toBe(false);
  });

  test("meldet nicht geschlossene Gruppe mit Position", () => {
    const result = compileRegexSearch("ab(cd");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.index).toBe(2);
      expect(describeRegexError(result.error)).toContain("Position 3");
    }
  });

  test("meldet überzählige schließende Klammer", () => {
    const result = compileRegexSearch("ab)cd");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.index).toBe(2);
  });

  test("meldet offene Zeichenklasse", () => {
    const result = compileRegexSearch("a[bc");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.index).toBe(1);
  });

  test("meldet Quantifizierer ohne Vorgänger", () => {
    const result = compileRegexSearch("*abc");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.index).toBe(0);
  });

  test("meldet ungültigen Wiederholungsbereich", () => {
    const result = compileRegexSearch("a{3,1}");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.index).toBe(1);
  });

  test("meldet offene Escape-Sequenz", () => {
    const result = compileRegexSearch("abc\\");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.index).toBe(3);
  });
});

describe("regexSearchFlags", () => {
  test("setzt Flags gemäß Optionen", () => {
    expect(regexSearchFlags()).toBe("gi");
    expect(regexSearchFlags({ caseSensitive: true })).toBe("g");
    expect(regexSearchFlags({ caseSensitive: true, multiline: true, dotAll: true })).toBe("gms");
  });
});

describe("escapeRegexLiteral", () => {
  test("entschärft Metazeichen", () => {
    expect(escapeRegexLiteral("a.b*c")).toBe("a\\.b\\*c");
    const compiled = compileRegexSearch(escapeRegexLiteral("count(*)"));
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.regex.test("select count(*) from t")).toBe(true);
  });
});

describe("countRegexMatches", () => {
  test("zählt Treffer über Zeilen hinweg", () => {
    const compiled = compileRegexSearch("\\d+");
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(countRegexMatches(["1 und 2", "keine", "3"], compiled.regex)).toBe(3);
  });

  test("bricht bei leeren Treffern nicht ab", () => {
    const compiled = compileRegexSearch("a*");
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(countRegexMatches(["bb"], compiled.regex)).toBe(3);
  });

  test("zählt bei nicht-globalem Muster pro Wert", () => {
    const compiled = compileRegexSearch("a", { global: false });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(countRegexMatches(["aaa", "b", "ba"], compiled.regex)).toBe(2);
  });
});

describe("insertRegexPattern", () => {
  test("fügt Muster an der Cursorposition ein", () => {
    expect(insertRegexPattern("abc", 3, 3, "\\d+")).toEqual({ value: "abc\\d+", cursor: 6 });
  });

  test("ersetzt die Auswahl", () => {
    expect(insertRegexPattern("abcdef", 1, 4, "X")).toEqual({ value: "aXef", cursor: 2 });
  });

  test("klemmt Positionen ab", () => {
    expect(insertRegexPattern("ab", 99, 99, "Z")).toEqual({ value: "abZ", cursor: 3 });
  });
});

describe("regexLiteralPrefilter", () => {
  test("findet die längste literale Zeichenfolge", () => {
    expect(regexLiteralPrefilter("create\\s+table")).toBe("create");
    expect(regexLiteralPrefilter("\\bWORT\\b")).toBe("WORT");
    expect(regexLiteralPrefilter("(alpha|betaXY)")).toBe("betaXY");
  });

  test("lässt quantifizierte Endzeichen weg", () => {
    expect(regexLiteralPrefilter("insert+")).toBe("inser");
  });

  test("liefert leeren Text ohne Literale", () => {
    expect(regexLiteralPrefilter("[a-z]+\\d*")).toBe("");
  });
});

describe("REGEX_PATTERN_LIBRARY", () => {
  test("enthält ausschließlich gültige Muster mit eindeutigen IDs", () => {
    const ids = new Set<string>();
    for (const template of REGEX_PATTERN_LIBRARY) {
      expect(ids.has(template.id)).toBe(false);
      ids.add(template.id);
      expect(compileRegexSearch(template.pattern).ok).toBe(true);
    }
    expect(REGEX_PATTERN_LIBRARY.length).toBeGreaterThan(5);
  });
});

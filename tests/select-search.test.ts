import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { matchesSelectSearch, selectItemText } from "../src/lib/select-search";

describe("select-search", () => {
  test("liest Text aus verschachtelten Kindern", () => {
    const node = createElement("span", null, ["public", createElement("em", null, ".kunde")]);
    expect(selectItemText(node)).toBe("public .kunde");
  });

  test("matcht Label und Value case-insensitiv", () => {
    expect(matchesSelectSearch("Kunde", "public.kunde", "kund")).toBe(true);
    expect(matchesSelectSearch("Kunde", "public.kunde", "public")).toBe(true);
    expect(matchesSelectSearch("Kunde", "public.kunde", "artikel")).toBe(false);
  });

  test("leere Suche zeigt alles", () => {
    expect(matchesSelectSearch(null, undefined, "")).toBe(true);
  });
});

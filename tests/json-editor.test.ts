import { describe, expect, test } from "bun:test";

import {
  convertValue,
  findMatches,
  flattenRows,
  insertAfter,
  insertChild,
  moveItem,
  parseTypedInput,
  pathId,
  removeAt,
  renameKey,
  sortKeysDeep,
  stringHint,
  tableShape,
  toJsonPath,
  toPostgresAccessor,
  toPostgresPath,
} from "../src/lib/json-editor";

const doc = { user: { name: "Ada", tags: ["a", "b"] }, "odd key": 1 };

describe("json-editor", () => {
  test("Pfade werden in alle Formate übersetzt", () => {
    expect(toJsonPath(["user", "tags", 0])).toBe("$.user.tags[0]");
    expect(toJsonPath(["odd key"])).toBe('$["odd key"]');
    expect(toPostgresAccessor(["user", "tags", 0], "Payload")).toBe(
      `"Payload"->'user'->'tags'->>0`,
    );
    expect(toPostgresAccessor(["it's"], "data", false)).toBe(`data->'it''s'`);
    expect(toPostgresPath(["user", "odd key", 1])).toBe(`'{user,"odd key",1}'`);
  });

  test("Bearbeitungen sind unveränderlich und behalten die Reihenfolge", () => {
    const renamed = renameKey(doc, ["user", "name"], "fullName") as typeof doc;
    expect(Object.keys(renamed.user)).toEqual(["fullName", "tags"]);
    expect(doc.user.name).toBe("Ada");
    expect(removeAt(doc, ["user", "tags", 0])).toEqual({
      user: { name: "Ada", tags: ["b"] },
      "odd key": 1,
    });
    const after = insertAfter(doc, ["user", "name"], 5, true);
    expect(after.path).toEqual(["user", "name_kopie"]);
    expect(Object.keys((after.root as typeof doc).user)).toEqual(["name", "name_kopie", "tags"]);
    expect(insertChild(doc, ["user", "tags"], "c").path).toEqual(["user", "tags", 2]);
    expect(moveItem(doc, ["user", "tags", 1], -1)?.root).toEqual({
      user: { name: "Ada", tags: ["b", "a"] },
      "odd key": 1,
    });
    expect(moveItem(doc, ["user", "tags", 0], -1)).toBeNull();
  });

  test("Typumwandlung, Eingaben und Sortierung", () => {
    expect(convertValue('{"a":1}', "object")).toEqual({ a: 1 });
    expect(convertValue({ a: 1 }, "string")).toBe('{"a":1}');
    expect(convertValue("12", "number")).toBe(12);
    expect(parseTypedInput("abc", "number").ok).toBe(false);
    expect(parseTypedInput("true", "null")).toEqual({ ok: true, value: true });
    expect(parseTypedInput("42", "string")).toEqual({ ok: true, value: "42" });
    expect(Object.keys(sortKeysDeep({ b: 1, a: { d: 1, c: 2 } }) as object)).toEqual(["a", "b"]);
  });

  test("Baumzeilen, Suche, Tabellenform und Hinweise", () => {
    const rows = flattenRows(doc, new Set([pathId([]), pathId(["user"])]));
    expect(rows.map((row) => (row.closing ? `/${row.id}` : row.id))).toEqual([
      "[]",
      '["user"]',
      '["user","name"]',
      '["user","tags"]',
      '/["user"]#end',
      '["odd key"]',
      "/[]#end",
    ]);
    expect(findMatches(doc, "ad").map(pathId)).toEqual(['["user","name"]']);
    expect(tableShape([{ a: 1 }, { b: 2 }])?.columns).toEqual(["a", "b"]);
    expect(tableShape([1, 2])).toBeNull();
    expect(stringHint("https://l8db.dev")).toBe("url");
    expect(stringHint("2026-10-03T12:00:00Z")).toBe("date");
    expect(stringHint('{"nested":true}')).toBe("json");
    expect(stringHint("#ff8800")).toBe("color");
  });
});

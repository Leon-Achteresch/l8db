import { describe, expect, test } from "bun:test";
import {
  addFavorite,
  favoriteId,
  favoritesFor,
  moveFavorite,
  type ObjectFavorite,
  removeFavorite,
  toggleFavorite,
} from "../src/lib/object-favorites";

function fav(name: string, overrides: Partial<ObjectFavorite> = {}): ObjectFavorite {
  return {
    connectionId: "c1",
    database: "app",
    schema: "public",
    name,
    type: "table",
    addedAt: 1,
    ...overrides,
  };
}

describe("favoriteId", () => {
  test("unterscheidet Verbindung, Datenbank, Schema und Typ", () => {
    const base = fav("kunde");
    expect(favoriteId(base)).not.toBe(favoriteId({ ...base, connectionId: "c2" }));
    expect(favoriteId(base)).not.toBe(favoriteId({ ...base, database: "other" }));
    expect(favoriteId(base)).not.toBe(favoriteId({ ...base, schema: "billing" }));
    expect(favoriteId(base)).not.toBe(favoriteId({ ...base, type: "view" }));
  });
});

describe("Mutationen", () => {
  test("addFavorite ignoriert Duplikate", () => {
    const list = addFavorite([], fav("kunde"));
    expect(addFavorite(list, fav("kunde"))).toHaveLength(1);
  });

  test("toggleFavorite fügt hinzu und entfernt", () => {
    const added = toggleFavorite([], fav("kunde"));
    expect(added).toHaveLength(1);
    expect(toggleFavorite(added, fav("kunde"))).toHaveLength(0);
  });

  test("removeFavorite entfernt nur den Treffer", () => {
    const list = [fav("a"), fav("b")];
    const next = removeFavorite(list, favoriteId(fav("a")));
    expect(next.map((item) => item.name)).toEqual(["b"]);
  });
});

describe("Reihenfolge", () => {
  const list = [fav("a"), fav("x", { connectionId: "c2" }), fav("b"), fav("c")];

  test("moveFavorite tauscht innerhalb derselben Verbindung", () => {
    const next = moveFavorite(list, favoriteId(fav("b")), -1);
    expect(favoritesFor(next, "c1", "app").map((item) => item.name)).toEqual(["b", "a", "c"]);
  });

  test("moveFavorite überschreitet Grenzen nicht", () => {
    expect(moveFavorite(list, favoriteId(fav("a")), -1)).toBe(list);
    expect(moveFavorite(list, favoriteId(fav("c")), 1)).toBe(list);
    expect(moveFavorite(list, "unbekannt", 1)).toBe(list);
  });
});

describe("favoritesFor", () => {
  test("filtert nach Verbindung und Datenbank", () => {
    const list = [fav("a"), fav("b", { database: "other" }), fav("c", { connectionId: "c2" })];
    expect(favoritesFor(list, "c1", "app").map((item) => item.name)).toEqual(["a"]);
    expect(favoritesFor(list, null, "app")).toEqual([]);
    expect(favoritesFor([fav("a", { database: null })], "c1", null).map((i) => i.name)).toEqual([
      "a",
    ]);
  });
});

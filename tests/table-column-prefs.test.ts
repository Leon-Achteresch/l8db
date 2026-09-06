import { beforeEach, describe, expect, test } from "bun:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  },
  configurable: true,
});

const {
  formatVisibleColumnNames,
  moveColumn,
  reorderVisibleColumns,
  resolveColumnPrefs,
  tableColumnPrefKey,
  toggleHiddenColumn,
  togglePinnedColumn,
  useTableColumnPrefs,
} = await import("../src/lib/table-column-prefs");

await useTableColumnPrefs.persist.rehydrate();

beforeEach(() => {
  storage.clear();
  useTableColumnPrefs.setState({ prefs: {} });
});

describe("resolveColumnPrefs", () => {
  test("übernimmt gespeicherte Reihenfolge und hängt neue Spalten an", () => {
    const resolved = resolveColumnPrefs(["id", "email", "name"], {
      order: ["name", "id"],
      hidden: ["email"],
    });
    expect(resolved.order).toEqual(["name", "id", "email"]);
    expect(resolved.hidden).toEqual(["email"]);
  });

  test("verwirft unbekannte Spalten und hält mindestens eine sichtbar", () => {
    const resolved = resolveColumnPrefs(["id"], {
      order: ["gone", "id"],
      hidden: ["id", "gone"],
    });
    expect(resolved.order).toEqual(["id"]);
    expect(resolved.hidden).toEqual([]);
  });
});

describe("reorderVisibleColumns", () => {
  test("verschiebt nur sichtbare Spalten und lässt ausgeblendete stehen", () => {
    expect(reorderVisibleColumns(["id", "secret", "name", "email"], ["secret"], 2, 0)).toEqual([
      "email",
      "secret",
      "id",
      "name",
    ]);
  });
});

describe("toggleHiddenColumn", () => {
  test("blendet aus und wieder ein, letzte sichtbare bleibt", () => {
    expect(toggleHiddenColumn(["id", "name"], [], "name")).toEqual(["name"]);
    expect(toggleHiddenColumn(["id", "name"], ["name"], "name")).toEqual([]);
    expect(toggleHiddenColumn(["id"], [], "id")).toEqual([]);
  });
});

describe("moveColumn", () => {
  test("tauscht Positionen", () => {
    expect(moveColumn(["id", "name", "email"], 2, 0)).toEqual(["email", "id", "name"]);
  });
});

describe("table column prefs store", () => {
  test("merkt Prefs pro Connection und Tabelle", () => {
    const keyA = tableColumnPrefKey("conn-a", "public", "users");
    const keyB = tableColumnPrefKey("conn-b", "public", "users");
    useTableColumnPrefs.getState().setPref(keyA, { order: ["name", "id"], hidden: ["email"] });
    useTableColumnPrefs.getState().setPref(keyB, { order: ["id"], hidden: [] });
    expect(useTableColumnPrefs.getState().prefs[keyA]).toEqual({
      order: ["name", "id"],
      hidden: ["email"],
    });
    expect(useTableColumnPrefs.getState().prefs[keyB]).toEqual({ order: ["id"], hidden: [] });
    useTableColumnPrefs.getState().resetPref(keyA);
    expect(useTableColumnPrefs.getState().prefs[keyA]).toBeUndefined();
    expect(useTableColumnPrefs.getState().prefs[keyB]).toEqual({ order: ["id"], hidden: [] });
  });
});

describe("Spalten fixieren", () => {
  test("fixierte Spalten stehen in ihrer Reihenfolge vorn", () => {
    const resolved = resolveColumnPrefs(["id", "email", "name"], {
      order: ["email", "name", "id"],
      hidden: [],
      pinned: ["name", "id"],
    });
    expect(resolved.pinned).toEqual(["name", "id"]);
    expect(resolved.order).toEqual(["name", "id", "email"]);
  });

  test("entfernt gelöschte Spalten aus der Fixierung", () => {
    const resolved = resolveColumnPrefs(["id"], {
      order: ["id"],
      hidden: [],
      pinned: ["gone", "id", "id"],
    });
    expect(resolved.pinned).toEqual(["id"]);
  });

  test("togglePinnedColumn fixiert und löst", () => {
    expect(togglePinnedColumn(["id", "name"], [], "name")).toEqual(["name"]);
    expect(togglePinnedColumn(["id", "name"], ["name"], "name")).toEqual([]);
    expect(togglePinnedColumn(["id", "name"], [], "weg")).toEqual([]);
  });

  test("speichert Fixierung im Store", () => {
    const key = tableColumnPrefKey("conn-a", "public", "users");
    useTableColumnPrefs.getState().setPref(key, { order: ["id"], hidden: [], pinned: ["id"] });
    expect(useTableColumnPrefs.getState().prefs[key]?.pinned).toEqual(["id"]);
  });
});

describe("formatVisibleColumnNames", () => {
  test("kopiert sichtbare Spalten in Grid-Reihenfolge ohne interne Spalten", () => {
    expect(formatVisibleColumnNames(["name", "__ctid__", "id", "email"], ["email"])).toBe(
      "name, id",
    );
  });

  test("liefert leeren Text ohne sichtbare Spalten", () => {
    expect(formatVisibleColumnNames([], [])).toBe("");
  });
});

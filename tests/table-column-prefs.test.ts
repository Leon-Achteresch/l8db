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
  applyLayoutProfile,
  createLayoutProfile,
  formatVisibleColumnNames,
  moveColumn,
  reorderVisibleColumns,
  resolveColumnPrefs,
  tableColumnPrefKey,
  normalizeLayoutProfileName,
  removeLayoutProfile,
  renameLayoutProfile,
  toggleHiddenColumn,
  togglePinnedColumn,
  upsertLayoutProfile,
  useTableColumnPrefs,
} = await import("../src/lib/table-column-prefs");

await useTableColumnPrefs.persist.rehydrate();

beforeEach(() => {
  storage.clear();
  useTableColumnPrefs.setState({ prefs: {}, profiles: {} });
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

describe("Layoutprofile", () => {
  const profile = createLayoutProfile("p1", "  Analyse  Ansicht ", {
    order: ["id", "name", "email"],
    hidden: ["email"],
    pinned: ["id"],
  });

  test("normalisiert den Namen beim Anlegen", () => {
    expect(normalizeLayoutProfileName("  Analyse  Ansicht ")).toBe("Analyse Ansicht");
    expect(profile.name).toBe("Analyse Ansicht");
  });

  test("legt neue Profile an und ersetzt gleichnamige", () => {
    const list = upsertLayoutProfile([], profile);
    expect(list).toHaveLength(1);
    const replaced = upsertLayoutProfile(
      list,
      createLayoutProfile("p2", "analyse ansicht", { order: ["name"], hidden: [], pinned: [] }),
    );
    expect(replaced).toHaveLength(1);
    expect(replaced[0].id).toBe("p1");
    expect(replaced[0].order).toEqual(["name"]);
  });

  test("ignoriert Profile ohne Namen", () => {
    expect(
      upsertLayoutProfile([], createLayoutProfile("p9", "   ", { order: [], hidden: [] })),
    ).toEqual([]);
  });

  test("benennt um und verhindert Namenskollisionen", () => {
    const list = [profile, createLayoutProfile("p2", "Kompakt", { order: [], hidden: [] })];
    expect(renameLayoutProfile(list, "p2", " Export ")[1].name).toBe("Export");
    expect(renameLayoutProfile(list, "p2", "analyse ansicht")[1].name).toBe("Kompakt");
    expect(renameLayoutProfile(list, "p2", "  ")[1].name).toBe("Kompakt");
  });

  test("löscht Profile anhand der Id", () => {
    expect(removeLayoutProfile([profile], "p1")).toEqual([]);
    expect(removeLayoutProfile([profile], "unbekannt")).toHaveLength(1);
  });

  test("wendet Profile verträglich auf geänderte Spalten an", () => {
    const applied = applyLayoutProfile(["id", "name", "created_at"], profile);
    expect(applied.order).toEqual(["id", "name", "created_at"]);
    expect(applied.hidden).toEqual([]);
    expect(applied.pinned).toEqual(["id"]);
  });

  test("zieht fixierte Spalten des Profils nach vorn", () => {
    const applied = applyLayoutProfile(
      ["id", "name", "email"],
      createLayoutProfile("p3", "Pin", {
        order: ["id", "name", "email"],
        hidden: [],
        pinned: ["email"],
      }),
    );
    expect(applied.order).toEqual(["email", "id", "name"]);
  });

  test("speichert Profile pro Tabellenschlüssel im Store", () => {
    const key = tableColumnPrefKey("conn", "public", "users");
    useTableColumnPrefs.getState().setProfiles(key, [profile]);
    expect(useTableColumnPrefs.getState().profiles[key]).toHaveLength(1);
  });
});

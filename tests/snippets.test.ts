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
  findShortcutConflict,
  normalizeShortcut,
  searchSnippets,
  snippetCategories,
  snippetPlaceholders,
  toMonacoSnippet,
  useSnippetsStore,
} = await import("../src/lib/snippets");

type Snippet = ReturnType<typeof useSnippetsStore.getState>["snippets"][number];

await useSnippetsStore.persist.rehydrate();

function snippet(partial: Partial<Snippet>): Snippet {
  return {
    id: partial.id ?? "id",
    name: partial.name ?? "Name",
    shortcut: partial.shortcut ?? "kz",
    description: partial.description ?? "",
    category: partial.category ?? "",
    body: partial.body ?? "SELECT 1",
    createdAt: 0,
    updatedAt: 0,
  };
}

beforeEach(() => {
  storage.clear();
  useSnippetsStore.setState({ snippets: [] });
});

describe("toMonacoSnippet", () => {
  test("wandelt Platzhalter in nummerierte Tabstops", () => {
    expect(toMonacoSnippet("SELECT ${spalten} FROM ${tabelle}")).toBe(
      "SELECT ${1:spalten} FROM ${2:tabelle}",
    );
  });

  test("nutzt Vorgabewerte nach Doppelpunkt", () => {
    expect(toMonacoSnippet("SELECT ${spalten:*} FROM t")).toBe("SELECT ${1:*} FROM t");
  });

  test("verwendet für wiederholte Namen denselben Tabstop", () => {
    expect(toMonacoSnippet("${a} ${b} ${a}")).toBe("${1:a} ${2:b} $1");
  });

  test("bildet cursor auf den Endstop ab", () => {
    expect(toMonacoSnippet("SELECT * FROM ${t}\nWHERE ${cursor}")).toBe(
      "SELECT * FROM ${1:t}\nWHERE $0",
    );
  });

  test("maskiert literale Sonderzeichen", () => {
    expect(toMonacoSnippet("cost $5 \\ end }")).toBe("cost \\$5 \\\\ end \\}");
  });

  test("erhält mehrzeiligen Text", () => {
    const body = "SELECT ${col}\nFROM ${tab}\nWHERE 1 = 1";
    expect(toMonacoSnippet(body).split("\n")).toHaveLength(3);
  });

  test("liefert leeren Text unverändert", () => {
    expect(toMonacoSnippet("")).toBe("");
  });
});

describe("snippetPlaceholders", () => {
  test("listet Platzhalternamen ohne Duplikate und ohne cursor", () => {
    expect(snippetPlaceholders("${a:1} ${b} ${a} ${cursor}")).toEqual(["a", "b"]);
  });
});

describe("findShortcutConflict", () => {
  test("erkennt doppelte Kürzel unabhängig von Groß-/Kleinschreibung", () => {
    const list = [snippet({ id: "1", shortcut: "Sel", name: "Select" })];
    expect(findShortcutConflict(list, "sel")?.id).toBe("1");
  });

  test("ignoriert den bearbeiteten Eintrag", () => {
    const list = [snippet({ id: "1", shortcut: "sel" })];
    expect(findShortcutConflict(list, "sel", "1")).toBeNull();
  });

  test("meldet keinen Konflikt für leere Kürzel", () => {
    expect(findShortcutConflict([snippet({ id: "1", shortcut: "" })], "  ")).toBeNull();
  });
});

describe("searchSnippets", () => {
  const list = [
    snippet({ id: "1", name: "Aktive Sessions", category: "Diagnose", description: "Läufer" }),
    snippet({ id: "2", name: "Insert Vorlage", category: "DML", description: "Zeile anlegen" }),
  ];

  test("findet über Name", () => {
    expect(searchSnippets(list, "sessions").map((s) => s.id)).toEqual(["1"]);
  });

  test("findet über Kategorie", () => {
    expect(searchSnippets(list, "dml").map((s) => s.id)).toEqual(["2"]);
  });

  test("findet über Beschreibung", () => {
    expect(searchSnippets(list, "zeile").map((s) => s.id)).toEqual(["2"]);
  });

  test("gibt bei leerem Suchbegriff alles zurück", () => {
    expect(searchSnippets(list, "  ")).toHaveLength(2);
  });
});

describe("Store", () => {
  test("legt an, bearbeitet und löscht persistent", () => {
    const created = useSnippetsStore.getState().addSnippet({
      name: " Test ",
      shortcut: " sel ",
      description: " d ",
      category: " c ",
      body: "SELECT 1",
    });
    expect(created.name).toBe("Test");
    expect(normalizeShortcut(created.shortcut)).toBe("sel");

    useSnippetsStore.getState().updateSnippet(created.id, {
      name: "Neu",
      shortcut: "n",
      description: "",
      category: "DDL",
      body: "SELECT 2",
    });
    expect(useSnippetsStore.getState().snippets[0].name).toBe("Neu");
    expect(snippetCategories(useSnippetsStore.getState().snippets)).toEqual(["DDL"]);
    expect(storage.get("l8db.snippets")).toContain("SELECT 2");

    useSnippetsStore.getState().deleteSnippet(created.id);
    expect(useSnippetsStore.getState().snippets).toHaveLength(0);
  });
});

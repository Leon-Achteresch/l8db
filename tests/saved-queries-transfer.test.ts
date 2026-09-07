import { describe, expect, test } from "bun:test";
import type { SavedQuery } from "@/lib/saved-queries";
import {
  buildSavedQueryExport,
  findSavedQueryDuplicate,
  parseSavedQueryImport,
  resolveSavedQueryImport,
  SAVED_QUERY_EXPORT_FORMAT,
  SAVED_QUERY_EXPORT_VERSION,
  serializeSavedQueryExport,
  uniqueCopyName,
} from "@/lib/saved-queries-transfer";

function query(id: string, name: string, sql: string): SavedQuery {
  return { id, name, sql, createdAt: 1700000000000 };
}

const EXISTING = [query("a", "Umsatz", "SELECT 1")];

function fileFor(entries: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: SAVED_QUERY_EXPORT_FORMAT,
    version: SAVED_QUERY_EXPORT_VERSION,
    exportedAt: "2026-01-01T00:00:00.000Z",
    queries: entries,
    ...overrides,
  });
}

describe("export", () => {
  test("versioniert und behält Name und SQL", () => {
    const file = buildSavedQueryExport([query("a", "Umsatz", "select  1\n-- x")], new Date(0));
    expect(file.format).toBe(SAVED_QUERY_EXPORT_FORMAT);
    expect(file.version).toBe(SAVED_QUERY_EXPORT_VERSION);
    expect(file.exportedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(file.queries[0]).toEqual({
      id: "a",
      name: "Umsatz",
      sql: "select  1\n-- x",
      createdAt: 1700000000000,
    });
  });

  test("serialisiert nur bekannte Felder ohne Verbindungsdaten", () => {
    const withExtra = {
      ...query("a", "Umsatz", "SELECT 1"),
      connectionString: "postgres://u:p@h/db",
    } as SavedQuery;
    const text = serializeSavedQueryExport([withExtra]);
    expect(text).not.toContain("connectionString");
    expect(text).not.toContain("postgres://");
  });
});

describe("import parsing", () => {
  test("lehnt fremdes Format und zu neue Version ab", () => {
    expect(parseSavedQueryImport("{", EXISTING).error).toContain("JSON");
    expect(parseSavedQueryImport(JSON.stringify({ format: "x" }), EXISTING).error).toContain(
      "kein l8db-Query-Export",
    );
    expect(parseSavedQueryImport(fileFor([], { version: 99 }), EXISTING).error).toContain("99");
  });

  test("markiert ungültige Einträge einzeln", () => {
    const parsed = parseSavedQueryImport(
      fileFor([{ name: "Ok", sql: "SELECT 2" }, { name: "Leer", sql: "  " }, 5]),
      EXISTING,
    );
    expect(parsed.error).toBeNull();
    expect(parsed.candidates[0]?.error).toBeNull();
    expect(parsed.candidates[1]?.error).toBe("SQL fehlt.");
    expect(parsed.candidates[2]?.error).toBe("Eintrag ist kein Objekt.");
    expect(parsed.candidates[2]?.label).toBe("Eintrag 3");
  });

  test("erkennt Dubletten über Id und Namen", () => {
    const parsed = parseSavedQueryImport(
      fileFor([
        { id: "a", name: "Anders", sql: "SELECT 1" },
        { id: "z", name: "umsatz", sql: "SELECT 3" },
        { id: "y", name: "Neu", sql: "SELECT 4" },
      ]),
      EXISTING,
    );
    expect(parsed.candidates[0]?.duplicateOf?.id).toBe("a");
    expect(parsed.candidates[1]?.duplicateOf?.id).toBe("a");
    expect(parsed.candidates[2]?.duplicateOf).toBeNull();
  });

  test("findSavedQueryDuplicate liefert null ohne Treffer", () => {
    expect(
      findSavedQueryDuplicate({ id: "x", name: "Frei", sql: "SELECT 1", createdAt: 1 }, EXISTING),
    ).toBeNull();
  });
});

describe("resolve", () => {
  const parsed = parseSavedQueryImport(
    fileFor([
      { id: "a", name: "Umsatz", sql: "SELECT 9" },
      { id: "b", name: "Neu", sql: "SELECT 10" },
      { name: "Kaputt", sql: "" },
    ]),
    EXISTING,
  );

  test("überspringt Dubletten bei skip", () => {
    const result = resolveSavedQueryImport(parsed.candidates, new Set([0, 1, 2]), "skip", EXISTING);
    expect(result.map((entry) => entry.name)).toEqual(["Neu"]);
    expect(result[0]?.sql).toBe("SELECT 10");
  });

  test("legt Kopien mit neuer Id an", () => {
    const result = resolveSavedQueryImport(parsed.candidates, new Set([0, 1]), "copy", EXISTING);
    expect(result.map((entry) => entry.name)).toEqual(["Umsatz (Kopie)", "Neu"]);
    expect(result[0]?.id).not.toBe("a");
    expect(result[0]?.sql).toBe("SELECT 9");
  });

  test("berücksichtigt nur ausgewählte Einträge", () => {
    const result = resolveSavedQueryImport(parsed.candidates, new Set([1]), "copy", EXISTING);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Neu");
  });

  test("uniqueCopyName zählt hoch", () => {
    expect(uniqueCopyName("A", [])).toBe("A (Kopie)");
    expect(uniqueCopyName("A", ["A (Kopie)"])).toBe("A (Kopie 2)");
    expect(uniqueCopyName("A", ["A (Kopie)", "A (Kopie 2)"])).toBe("A (Kopie 3)");
  });
});

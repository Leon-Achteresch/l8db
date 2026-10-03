import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@tauri-apps/api/core", () => ({
  invoke: async () => {
    throw new Error("not available in tests");
  },
}));

const { selectScriptTarget } = await import("@/features/compare/data-compare-view/lib");
const { useDbSelectionStore } = await import("@/lib/db-selection");

const side = (connectionId: string | null, database: string | null) => ({
  connectionId,
  database,
  schema: "main",
  table: "kunden",
});

describe("Datenabgleich-Skript im Query-Tab öffnen", () => {
  beforeEach(() => {
    useDbSelectionStore.setState({ databaseByConnection: {}, schemaByConnection: {} });
  });

  test("öffnet das Skript auch für Ziele ohne Datenbanknamen wie SQLite", () => {
    useDbSelectionStore.setState({ databaseByConnection: { lite: "other" } });
    expect(selectScriptTarget(side("lite", null))).toBe("lite");
    expect(useDbSelectionStore.getState().databaseByConnection.lite).toBeUndefined();
  });

  test("wählt die verglichene Datenbank des Ziels aus", () => {
    useDbSelectionStore.setState({ databaseByConnection: { pg: "andere" } });
    expect(selectScriptTarget(side("pg", "shop"))).toBe("pg");
    expect(useDbSelectionStore.getState().databaseByConnection.pg).toBe("shop");
  });

  test("lehnt Ziele ohne Verbindung ab", () => {
    expect(selectScriptTarget(side(null, "shop"))).toBeNull();
  });
});

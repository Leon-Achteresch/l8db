import { afterEach, describe, expect, mock, test } from "bun:test";

const invocations: string[] = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    invocations.push(command);
    if (command === "list_transactions") return [];
    return null;
  },
}));

const { useConnectionsStore } = await import("../src/lib/connections/store");
const { useSettingsStore } = await import("../src/lib/settings");
const {
  connectionEnvironment,
  isProductionLocked,
  PRODUCTION_LOCK_MESSAGE,
  productionConfirmTexts,
  productionWriteBlock,
  useWriteModeStore,
} = await import("../src/lib/environments");
const { destructiveStatements, writesData } = await import("../src/lib/sql-safety");
const { invoke } = await import("../src/lib/db/core");
const { effectiveConnectionString } = await import("../src/lib/ssh");

const prod = {
  id: "p1",
  name: "Shop Prod",
  kind: "postgres" as const,
  sslMode: "prefer" as const,
  connectionString: "postgres://app@db-prod-1.example.com:5432/shop",
};

afterEach(() => {
  useConnectionsStore.setState({ connections: [], hostGroupRules: [] });
  useSettingsStore.setState({ productionReadOnly: false });
  useWriteModeStore.setState({ unlockedUntil: {} });
  invocations.length = 0;
});

describe("Umgebungen", () => {
  test("explizite Umgebung schlägt Hostregel", () => {
    const rules = [
      { id: "r", name: "Prod", pattern: "db-prod*", environment: "production" as const },
    ];
    expect(connectionEnvironment(prod, rules)).toBe("production");
    expect(connectionEnvironment({ ...prod, environment: "staging" }, rules)).toBe("staging");
    expect(
      connectionEnvironment({ ...prod, connectionString: "postgres://app@db-dev/shop" }, rules),
    ).toBeNull();
    expect(
      connectionEnvironment(prod, [{ id: "g", name: "Gruppe", pattern: "db-prod*" }]),
    ).toBeNull();
  });

  test("Produktion schreibgeschützt bis Schreibmodus aktiv", () => {
    const connection = { ...prod, environment: "production" as const };
    expect(isProductionLocked(connection)).toBe(false);
    useSettingsStore.setState({ productionReadOnly: true });
    expect(isProductionLocked(connection)).toBe(true);
    expect(productionWriteBlock(connection, "SELECT * FROM orders")).toBeNull();
    expect(productionWriteBlock(connection, "UPDATE orders SET x = 1 WHERE id = 2")).toBe(
      PRODUCTION_LOCK_MESSAGE,
    );
    expect(productionWriteBlock(connection, null)).toBe(PRODUCTION_LOCK_MESSAGE);
    useWriteModeStore.getState().unlock(connection.id);
    expect(isProductionLocked(connection)).toBe(false);
    useWriteModeStore.getState().unlock(connection.id, -1);
    expect(isProductionLocked(connection)).toBe(true);
  });

  test("Bestätigungstexte aus Verbindung und Datenbank", () => {
    expect(productionConfirmTexts(prod, "shop")).toEqual(["Shop Prod", "shop"]);
    expect(productionConfirmTexts(prod, null)).toEqual(["Shop Prod"]);
  });

  test("invoke blockiert Schreibbefehle auf gesperrter Produktion", async () => {
    useConnectionsStore.setState({ connections: [{ ...prod, environment: "production" }] });
    useSettingsStore.setState({ productionReadOnly: true });
    const locked = effectiveConnectionString({ ...prod, environment: "production" });
    expect(locked).toContain("default_transaction_read_only");
    await expect(
      invoke("update_row", { connectionString: locked, kind: "postgres" }),
    ).rejects.toThrow("Produktion ist schreibgeschützt");
    expect(invocations).not.toContain("update_row");
    useWriteModeStore.getState().unlock(prod.id);
    const unlocked = effectiveConnectionString({ ...prod, environment: "production" });
    expect(unlocked).not.toContain("default_transaction_read_only");
    await invoke("update_row", { connectionString: unlocked, kind: "postgres" });
    expect(invocations).toContain("update_row");
  });
});

describe("SQL-Sicherheit für Produktion", () => {
  test("strenger Modus erkennt ALTER, DROP und UPDATE ohne WHERE", () => {
    const sql =
      "ALTER TABLE t ADD c int; DROP VIEW v; UPDATE t SET a = 1; UPDATE t SET a = 2 WHERE id = 1";
    expect(destructiveStatements(sql, "postgres")).toEqual([]);
    expect(
      destructiveStatements(sql, "postgres", { strict: true }).map((entry) => entry.reason),
    ).toEqual(["Struktur ändern", "Objekt löschen", "UPDATE ohne WHERE"]);
  });

  test("Schreibzugriffe werden je Dialekt erkannt", () => {
    expect(writesData("SELECT * FROM t; SHOW tables", "mysql")).toBe(false);
    expect(writesData("WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x", "postgres")).toBe(
      true,
    );
    expect(writesData("SELECT replace(name, 'a', 'b') FROM t", "postgres")).toBe(false);
    expect(writesData("INSERT INTO t VALUES (1)", "sqlite")).toBe(true);
    expect(writesData("db.users.find({})", "mongodb")).toBe(false);
    expect(writesData("db.users.deleteMany({})", "mongodb")).toBe(true);
    expect(writesData("HGETALL user:1", "redis")).toBe(false);
    expect(writesData("DEL user:1", "redis")).toBe(true);
  });
});

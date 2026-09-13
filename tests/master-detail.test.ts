import { beforeEach, describe, expect, test } from "bun:test";
import { createJSONStorage } from "zustand/middleware";

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
const { bindMasterDetail, masterDetailKey, masterDetailScriptError, useMasterDetail } =
  await import("../src/lib/master-detail");
useMasterDetail.persist.setOptions({
  storage: createJSONStorage(() => ({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, value);
    },
    removeItem: (key) => {
      storage.delete(key);
    },
  })),
});
const sql = "SELECT * FROM orders WHERE user_id::text IS NOT DISTINCT FROM :master";
beforeEach(() => {
  useMasterDetail.setState({ scripts: {}, savedScripts: {}, selections: {}, sourceColumns: {} });
  storage.clear();
});

describe("master detail", () => {
  test("binds values separately and preserves casts and quoted placeholders", () => {
    const value = "O'Reilly'; DROP TABLE orders; --";
    expect(
      bindMasterDetail(
        "SELECT ':master', id FROM orders WHERE id = :master::uuid OR parent = :master::uuid",
        value,
      ),
    ).toEqual({
      sql: "SELECT ':master', id FROM orders WHERE id = $1::uuid OR parent = $1::uuid",
      params: [value],
    });
    expect(bindMasterDetail(sql, null).params).toEqual([null]);
    expect(bindMasterDetail(sql, 0).params).toEqual(["0"]);
    expect(bindMasterDetail(sql, false).params).toEqual(["false"]);
    expect(bindMasterDetail(sql, "").params).toEqual([""]);
  });
  test("requires a master parameter and rejects writes and extra statements", () => {
    expect(masterDetailScriptError(sql)).toBeNull();
    for (const invalid of [
      "SELECT ':master'",
      "SELECT 1 -- :master",
      "DELETE FROM orders WHERE id=:master",
      "SELECT :master; SELECT 1",
      "SELECT :master, :other",
      "SELECT $1",
      "WITH removed AS (DELETE FROM orders RETURNING *) SELECT :master",
      "SELECT :master INTO new_table",
    ]) {
      expect(masterDetailScriptError(invalid)).not.toBeNull();
      expect(() => useMasterDetail.getState().saveScript("invalid", invalid)).toThrow();
    }
  });
  test("persists scripts while keeping cell data in memory", async () => {
    useMasterDetail.getState().saveScript("pair", sql);
    useMasterDetail
      .getState()
      .selectCell("source", { column: "email", rowIndex: 1, value: "private@example.test" });
    const saved = storage.get("l8db.master-detail")!;
    expect(JSON.parse(saved).state).toEqual({ scripts: { pair: sql }, savedScripts: {}, sourceColumns: { pair: "" } });
    expect(saved).not.toContain("private@example.test");
    useMasterDetail.setState({ scripts: {}, savedScripts: {}, selections: {}, sourceColumns: {} });
    storage.set("l8db.master-detail", saved);
    await useMasterDetail.persist.rehydrate();
    expect(useMasterDetail.getState().scripts.pair).toBe(sql);
    expect(useMasterDetail.getState().selections).toEqual({});
    useMasterDetail.getState().removeScript("pair");
    expect(JSON.parse(storage.get("l8db.master-detail")!).state.scripts).toEqual({});
  });
  test("keeps tab pairs separate and clears deselected cells", () => {
    expect(masterDetailKey("connection-a/master", "detail")).not.toBe(
      masterDetailKey("connection-b/master", "detail"),
    );
    expect(masterDetailKey("master", null)).toBeNull();
    useMasterDetail.getState().selectCell("master", { column: "id", rowIndex: 0, value: null });
    expect(useMasterDetail.getState().selections.master.value).toBeNull();
    useMasterDetail.getState().selectCell("master", null);
    expect(useMasterDetail.getState().selections.master).toBeUndefined();
  });
});

test("keeps multiple saved pairs after unlinking and reloading", async () => {
  const store = useMasterDetail.getState();
  store.saveScript("orders", sql, { master: "AUFTRAG", detail: "AUFTRAG POS" });
  const otherSql = "SELECT * FROM items WHERE customer = :master";
  store.saveScript("customers", otherSql, { master: "KUNDE", detail: "ARTIKEL" });
  store.removeScript("orders");
  const saved = storage.get("l8db.master-detail")!;
  useMasterDetail.setState({ scripts: {}, savedScripts: {}, selections: {}, sourceColumns: {} });
  storage.set("l8db.master-detail", saved);
  await useMasterDetail.persist.rehydrate();
  expect(useMasterDetail.getState().savedScripts).toEqual({
    orders: { master: "AUFTRAG", detail: "AUFTRAG POS", sql },
    customers: { master: "KUNDE", detail: "ARTIKEL", sql: otherSql },
  });
  expect(useMasterDetail.getState().scripts.orders).toBeUndefined();
  useMasterDetail.getState().removeSavedScript("orders");
  expect(useMasterDetail.getState().savedScripts.orders).toBeUndefined();
  expect(useMasterDetail.getState().savedScripts.customers.sql).toBe(otherSql);
});


test("binds the configured column when another cell is selected and preserves NULL", async () => {
  const { masterColumnSelection } = await import("../src/lib/master-detail");
  const selection = { column: "name", rowIndex: 2, value: "Alice", row: { id: 7, name: "Alice", parent: null } };
  expect(masterColumnSelection(selection, "id")?.value).toBe(7);
  expect(masterColumnSelection(selection, "parent")?.value).toBeNull();
  expect(masterColumnSelection(selection, "missing")).toBeUndefined();
  useMasterDetail.getState().saveScript("pair", sql, { master: "users", detail: "orders", column: "id" });
  useMasterDetail.getState().selectCell("master", selection);
  const persisted = storage.get("l8db.master-detail")!;
  expect(persisted).not.toContain("Alice");
  expect(JSON.parse(persisted).state.sourceColumns.pair).toBe("id");
  expect(JSON.parse(persisted).state.savedScripts.pair.column).toBe("id");
  useMasterDetail.getState().removeScript("pair");
  expect(useMasterDetail.getState().sourceColumns.pair).toBeUndefined();
});


test("binds named master columns, repeated references, casts and quoted names", () => {
  const row = { ID: 42, tenant: "O'Reilly", "Order No": 0, optional: null };
  expect(bindMasterDetail('SELECT * FROM orders WHERE id=:master.ID::int AND tenant=:master.tenant OR parent=:master.ID', "ignored", row)).toEqual({
    sql: 'SELECT * FROM orders WHERE id=$1::int AND tenant=$2 OR parent=$1', params: ["42", "O'Reilly"],
  });
  expect(bindMasterDetail('SELECT :master."Order No", :master.optional', "ignored", row)).toEqual({ sql: "SELECT $1, $2", params: ["0", null] });
  expect(bindMasterDetail("SELECT ':master.ID', :master.ID /* :master.other */", null, row)).toEqual({ sql: "SELECT ':master.ID', $1 /* :master.other */", params: ["42"] });
  expect(() => bindMasterDetail("SELECT :master.missing", null, row)).toThrow("missing");
  for (const sql of ["SELECT :master.", "SELECT :master.ID.other", "SELECT :other.ID"])
    expect(masterDetailScriptError(sql)).not.toBeNull();
});

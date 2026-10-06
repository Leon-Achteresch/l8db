import { describe, expect, test } from "bun:test";
import {
  createBufferedJsonStorage,
  createChangedOnlyJsonStorage,
} from "../src/lib/buffered-storage";

function fixture(delay = 10000) {
  const values = new Map<string, string>();
  const writes: string[] = [];
  const storage = createBufferedJsonStorage<{ sql: string }>(
    () => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        writes.push(value);
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    }),
    delay,
  );
  return { storage, writes, values };
}

describe("buffered tab persistence", () => {
  test("coalesces typing before serialization and hydrates the latest pending value", () => {
    const { storage, writes, values } = fixture();
    let serializations = 0;
    for (let i = 0; i < 100; i++) {
      storage.setItem("tabs", {
        state: {
          sql: String(i),
          toJSON() {
            serializations++;
            return { sql: this.sql };
          },
        } as { sql: string },
        version: 3,
      });
    }
    expect(serializations).toBe(0);
    expect(writes).toHaveLength(0);
    expect(storage.getItem("tabs")?.state.sql).toBe("99");
    storage.flush();
    expect(serializations).toBe(1);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(values.get("tabs")!).version).toBe(3);
    expect(storage.getItem("tabs")?.state.sql).toBe("99");
    storage.dispose();
  });

  test("removal cannot be undone by a pending write", () => {
    const { storage, values } = fixture();
    storage.setItem("tabs", { state: { sql: "SELECT 1" } });
    storage.removeItem("tabs");
    storage.flush();
    expect(values.has("tabs")).toBe(false);
    expect(storage.getItem("tabs")).toBeNull();
    storage.dispose();
  });

  test("flushes without waiting for typing to stop", async () => {
    const { storage, writes } = fixture(10);
    storage.setItem("tabs", { state: { sql: "SELECT 1" } });
    await Bun.sleep(25);
    expect(writes).toHaveLength(1);
    storage.setItem("tabs", { state: { sql: "SELECT 2" } });
    storage.dispose();
    expect(writes).toHaveLength(2);
    expect(storage.getItem("tabs")?.state.sql).toBe("SELECT 2");
  });

  test("skips writes whose serialized state is already stored", () => {
    const { storage, writes } = fixture();
    storage.setItem("tabs", { state: { sql: "SELECT 1" }, version: 1 });
    storage.flush();
    for (let i = 0; i < 5; i++) {
      storage.setItem("tabs", { state: { sql: "SELECT 1" }, version: 1 });
      storage.flush();
    }
    expect(writes).toHaveLength(1);
    storage.setItem("tabs", { state: { sql: "SELECT 2" }, version: 1 });
    storage.flush();
    expect(writes).toHaveLength(2);
    storage.dispose();
  });
});

test("changed-only storage writes only when the persisted state changes", () => {
  const values = new Map<string, string>();
  const writes: string[] = [];
  const storage = createChangedOnlyJsonStorage<{ panes: string[] }>(() => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(key);
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  }));
  for (let i = 0; i < 5; i++) storage?.setItem("split", { state: { panes: ["a"] }, version: 0 });
  expect(writes).toEqual(["split"]);
  storage?.setItem("split", { state: { panes: ["a", "b"] }, version: 0 });
  expect(writes).toEqual(["split", "split"]);
  expect(storage?.getItem("split")).toEqual({ state: { panes: ["a", "b"] }, version: 0 });
});

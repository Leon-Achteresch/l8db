import { describe, expect, mock, test } from "bun:test";

const keychain = new Map<string, string>();
const keychainLog: string[] = [];
const slowAccounts = new Set<string>();
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "list_providers") return [];
    const account = String(args.account);
    if (command === "store_secret") {
      keychainLog.push(`store ${account}`);
      keychain.set(account, String(args.secret));
    }
    if (command === "load_secret") {
      if (slowAccounts.has(account)) await new Promise((resolve) => setTimeout(resolve, 30));
      return keychain.get(account) ?? null;
    }
    if (command === "delete_secret") {
      keychainLog.push(`delete ${account}`);
      keychain.delete(account);
    }
    return null;
  },
  Resource: class {},
  Channel: class {},
  transformCallback: () => 0,
}));
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
Object.defineProperty(globalThis, "localStorage", {
  value: window.localStorage,
  configurable: true,
});

function writeConnections(second: string): void {
  storage.set(
    "l8db.connections",
    JSON.stringify({
      state: {
        connections: [
          {
            id: "c1",
            name: "Turso",
            kind: "sqlite_http",
            connectionString: "libsql://h.turso.io",
            sslMode: "prefer",
          },
          {
            id: "c2",
            name: "Turso 2",
            kind: "sqlite_http",
            connectionString: second,
            sslMode: "prefer",
          },
        ],
      },
      version: 0,
    }),
  );
}

writeConnections("libsql://h2.turso.io");
keychain.set("c1:params", "authToken=tok1");
keychain.set("c2:params", "authToken=tok1");
keychain.set("c1", "pw");
slowAccounts.add("c1");

const { useConnectionsStore, initConnectionSecrets } = await import("../../src/lib/connections");
const { syncConnectionsFromStorage } = await import("../../src/lib/connections/store");

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function persisted(): string {
  return storage.get("l8db.connections") ?? "";
}

function inMemory(id: string): string {
  return (
    useConnectionsStore.getState().connections.find((entry) => entry.id === id)?.connectionString ??
    ""
  );
}

describe("query secrets across startup and windows", () => {
  test("a store write during startup never deletes the keychain token", async () => {
    const init = initConnectionSecrets();
    await wait(10);
    useConnectionsStore.getState().setServerOrder(["x"]);
    await wait();
    const duringStartup = keychain.get("c1:params");
    const persistedDuringStartup = persisted();
    await init;
    await wait();
    expect(duringStartup).toBe("authToken=tok1");
    expect(persistedDuringStartup).not.toContain("tok1");
    expect(inMemory("c1")).toContain("authToken=tok1");
    expect(inMemory("c2")).toContain("authToken=tok1");
    expect(keychain.get("c1:params")).toBe("authToken=tok1");
    expect(persisted()).not.toContain("tok1");
    expect(keychainLog.filter((entry) => entry.endsWith("c1:params"))).toEqual([]);
  });

  test("removing a token synced from another window deletes it from the keychain", async () => {
    writeConnections("libsql://h2.turso.io?authToken=tok2");
    syncConnectionsFromStorage();
    await wait();
    keychain.set("c2:params", "authToken=tok2");
    writeConnections("libsql://h2.turso.io");
    syncConnectionsFromStorage();
    await wait(40);
    expect(inMemory("c2")).toContain("authToken=tok2");
    useConnectionsStore.getState().updateConnection("c2", {
      name: "Turso 2",
      kind: "sqlite_http",
      connectionString: "libsql://h2.turso.io",
      sslMode: "prefer",
    });
    await wait();
    expect(keychain.has("c2:params")).toBe(false);
    expect(keychain.get("c1:params")).toBe("authToken=tok1");
    expect(persisted()).not.toContain("tok");
  });
});

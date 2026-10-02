import { describe, expect, mock, test } from "bun:test";

const keychain = new Map<string, string>();
let keychainUnavailable = false;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "list_providers") return [];
    if (command.endsWith("_secret") && keychainUnavailable) throw new Error("Keychain unavailable");
    if (command === "store_secret") keychain.set(String(args.account), String(args.secret));
    if (command === "load_secret") return keychain.get(String(args.account)) ?? null;
    if (command === "delete_secret") keychain.delete(String(args.account));
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

const { splitSecretParams, withSecretParams, stripConnectionSecrets } = await import(
  "../../src/lib/connection-export/export"
);
const { useConnectionsStore, initConnectionSecrets } = await import("../../src/lib/connections");
const { mergeWindowSync, syncConnectionsFromStorage } = await import(
  "../../src/lib/connections/store"
);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function persisted(): string {
  return storage.get("l8db.connections") ?? "";
}

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams);
}

const cases = [
  {
    kind: "sqlite_http" as const,
    url: "libsql://db-org.turso.io?authToken=turso-secret",
    secret: "turso-secret",
    persisted: "libsql://db-org.turso.io",
  },
  {
    kind: "clickhouse" as const,
    url: "clickhouse://default@ch.example.com:8443/analytics?secure=1&password=ch-secret",
    secret: "ch-secret",
    persisted: "clickhouse://default@ch.example.com:8443/analytics?secure=1",
  },
  {
    kind: "elasticsearch" as const,
    url: "elasticsearch://es.example.com:9200/?api_key=es-secret&tls=true",
    secret: "es-secret",
    persisted: "elasticsearch://es.example.com:9200/?tls=true",
  },
  {
    kind: "influxdb" as const,
    url: "influxdb://influx.example.com:8086/metrics?org=acme&token=influx-secret#frag",
    secret: "influx-secret",
    persisted: "influxdb://influx.example.com:8086/metrics?org=acme#frag",
  },
  {
    kind: "postgres" as const,
    url: "postgresql://app:pg-secret@db.example.com/app?sslmode=require&sslpassword=key-secret",
    secret: "key-secret",
    persisted: "postgresql://app@db.example.com/app?sslmode=require",
  },
];

describe("secret query parameters", () => {
  test("split and re-add secret parameters without touching the rest", () => {
    for (const entry of cases) {
      const split = splitSecretParams(entry.url);
      expect(split.secrets).not.toBeNull();
      expect(split.value).not.toContain(entry.secret);
      expect(params(withSecretParams(split.value, split.secrets))).toEqual(params(entry.url));
      expect(withSecretParams(entry.url, split.secrets)).toBe(entry.url);
    }
    expect(splitSecretParams("postgresql://u@h/db?sslmode=require")).toEqual({
      value: "postgresql://u@h/db?sslmode=require",
      secrets: null,
    });
    expect(splitSecretParams("libsql://h?auth%5Ftoken=x&a=1")).toEqual({
      value: "libsql://h?a=1",
      secrets: "auth%5Ftoken=x",
    });
    expect(stripConnectionSecrets(cases[1].url)).toBe(cases[1].persisted);
    expect(splitSecretParams("d1://acct@api.cloudflare.com/db?api_token=cf-secret").value).toBe(
      "d1://acct@api.cloudflare.com/db",
    );
    expect(splitSecretParams("elasticsearch://es:9200/?apikey=k&x=1").value).toBe(
      "elasticsearch://es:9200/?x=1",
    );
  });

  test("saved connections keep tokens out of localStorage and in the keychain", async () => {
    const ids = cases.map(
      (entry) =>
        useConnectionsStore.getState().addConnection({
          name: entry.kind,
          kind: entry.kind,
          connectionString: entry.url,
          sslMode: "prefer",
        }).id,
    );
    await flush();
    const stored = JSON.parse(persisted()).state.connections as { connectionString: string }[];
    for (const [index, entry] of cases.entries()) {
      expect(persisted()).not.toContain(entry.secret);
      expect(stored[index].connectionString).toBe(entry.persisted);
      expect(keychain.get(`${ids[index]}:params`)).toContain(entry.secret);
      expect(useConnectionsStore.getState().connections[index].connectionString).toBe(entry.url);
    }
  });

  test("tokens come back from the keychain after a restart", async () => {
    useConnectionsStore.setState({ connections: [] });
    storage.set(
      "l8db.connections",
      JSON.stringify({
        state: {
          connections: [
            ...cases.map((entry, index) => ({
              id: `restart-${index}`,
              name: entry.kind,
              kind: entry.kind,
              connectionString: entry.persisted,
              sslMode: "prefer",
            })),
            {
              id: "legacy",
              name: "Legacy",
              kind: "sqlite_http",
              connectionString: "libsql://legacy.turso.io?authToken=legacy-secret",
              sslMode: "prefer",
            },
          ],
        },
        version: 0,
      }),
    );
    for (const [index, entry] of cases.entries())
      keychain.set(`restart-${index}:params`, splitSecretParams(entry.url).secrets ?? "");
    keychain.set("restart-4", "pg-secret");
    await useConnectionsStore.persist.rehydrate();
    await initConnectionSecrets();
    for (const [index, entry] of cases.entries()) {
      const connection = useConnectionsStore.getState().connections[index];
      expect(params(connection.connectionString)).toEqual(params(entry.url));
      expect(connection.connectionString).toContain(entry.secret);
    }
    await flush();
    expect(persisted()).not.toContain("turso-secret");
    expect(persisted()).not.toContain("legacy-secret");
    expect(keychain.get("legacy:params")).toBe("authToken=legacy-secret");
    expect(
      useConnectionsStore.getState().connections.find((entry) => entry.id === "legacy")
        ?.connectionString,
    ).toBe("libsql://legacy.turso.io?authToken=legacy-secret");
  });

  test("removing the token from a connection removes it from the keychain", async () => {
    const id = "restart-0";
    useConnectionsStore.getState().updateConnection(id, {
      name: "Turso",
      kind: "sqlite_http",
      connectionString: "libsql://db-org.turso.io",
      sslMode: "prefer",
    });
    await flush();
    expect(keychain.has(`${id}:params`)).toBe(false);
    useConnectionsStore.getState().removeConnection("restart-1");
    await flush();
    expect(keychain.has("restart-1:params")).toBe(false);
  });

  test("window sync keeps the in-memory token when only secrets differ", () => {
    const live = { ...cases[0], id: "w", name: "W", connectionString: cases[0].url };
    const merged = mergeWindowSync(
      { connections: [{ ...live, connectionString: cases[0].persisted, sslMode: "prefer" }] },
      { connections: [{ ...live, sslMode: "prefer" }], activeId: null },
    );
    expect(merged.connections[0].connectionString).toBe(cases[0].url);
  });

  test("another window picks up a changed token from the keychain", async () => {
    const id = "restart-2";
    const current = useConnectionsStore.getState().connections.find((entry) => entry.id === id);
    expect(current?.connectionString).toContain("es-secret");
    const raw = JSON.parse(persisted());
    raw.state.connections = raw.state.connections.map(
      (entry: { id: string; connectionString: string }) =>
        entry.id === id
          ? { ...entry, connectionString: "elasticsearch://es2.example.com:9200/?tls=true" }
          : entry,
    );
    storage.set("l8db.connections", JSON.stringify(raw));
    keychain.set(`${id}:params`, "api_key=rotated");
    syncConnectionsFromStorage();
    useConnectionsStore.getState().setServerOrder([]);
    await flush();
    await flush();
    const synced = useConnectionsStore.getState().connections.find((entry) => entry.id === id);
    expect(params(synced?.connectionString ?? "")).toEqual({ tls: "true", api_key: "rotated" });
    expect(keychain.get(`${id}:params`)).toBe("api_key=rotated");
  });

  test("vault connections keep their tokens out of the keychain", async () => {
    const connection = useConnectionsStore.getState().addConnection({
      name: "Vault",
      kind: "sqlite_http",
      connectionString: "libsql://vault.turso.io?authToken=vault-secret",
      sslMode: "prefer",
      vault: true,
    });
    await flush();
    expect(persisted()).not.toContain("vault-secret");
    expect(keychain.has(`${connection.id}:params`)).toBe(false);
  });

  test("a token stays persisted while the keychain cannot store it", async () => {
    keychainUnavailable = true;
    try {
      const connection = useConnectionsStore.getState().addConnection({
        name: "Offline",
        kind: "influxdb",
        connectionString: "influxdb://offline.example.com:8086/db?token=offline-secret",
        sslMode: "prefer",
      });
      await flush();
      expect(persisted()).toContain("offline-secret");
      keychainUnavailable = false;
      useConnectionsStore.getState().setServerOrder([]);
      await flush();
      expect(keychain.get(`${connection.id}:params`)).toBe("token=offline-secret");
      expect(persisted()).not.toContain("offline-secret");
    } finally {
      keychainUnavailable = false;
    }
  });
});

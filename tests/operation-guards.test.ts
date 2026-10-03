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
const { useWriteModeStore } = await import("../src/lib/environments");
const { invoke, READ_ONLY_MESSAGE } = await import("../src/lib/db/core");
const { effectiveConnectionString } = await import("../src/lib/ssh");
const { operationContext } = await import("../src/lib/operation-context");

const LOCKED = "Produktion ist schreibgeschützt";

function connection(id: string, kind: string, url: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    kind,
    sslMode: "prefer",
    connectionString: url,
    ...extra,
  } as never;
}

afterEach(() => {
  useConnectionsStore.setState({ connections: [], hostGroupRules: [], activeId: null });
  useSettingsStore.setState({ productionReadOnly: false });
  useWriteModeStore.setState({ unlockedUntil: {} });
  invocations.length = 0;
});

describe("Produktionssperre bei mehrdeutigen Verbindungen", () => {
  for (const [kind, url] of [
    ["mysql", "mysql://app@db.example.com:3306/shop"],
    ["mssql", "sqlserver://app@db.example.com:1433/shop"],
    ["sqlite", "sqlite:///data/shop.db"],
    ["postgres", "postgres://app@db.example.com:5432/shop"],
  ] as const) {
    test(`${kind}: gleiche URL in Entwicklung und Produktion blockiert`, async () => {
      useSettingsStore.setState({ productionReadOnly: true });
      const dev = connection("dev", kind, url, { environment: "development" });
      const prod = connection("prod", kind, url, { environment: "production" });
      useConnectionsStore.setState({ connections: [dev, prod] });
      const target = effectiveConnectionString(prod);
      await expect(invoke("update_row", { connectionString: target, kind })).rejects.toThrow(
        LOCKED,
      );
      await expect(
        invoke("execute_query", { connectionString: target, kind, sql: "DELETE FROM t" }),
      ).rejects.toThrow(LOCKED);
      expect(operationContext({ connectionString: target, kind }).connectionId).toBe("prod");
      expect(invocations).not.toContain("update_row");
      expect(invocations).not.toContain("execute_query");
    });
  }
});

describe("Produktionssperre bei veralteter Verbindungszeichenfolge", () => {
  test("postgres: Zeichenfolge aus dem Schreibmodus nach Ablauf blockiert", async () => {
    useSettingsStore.setState({ productionReadOnly: true });
    const prod = connection("prod", "postgres", "postgres://app@db.example.com:5432/shop", {
      environment: "production",
    });
    useConnectionsStore.setState({ connections: [prod] });
    useWriteModeStore.getState().unlock("prod");
    const stale = effectiveConnectionString(prod);
    expect(stale).not.toContain("default_transaction_read_only");
    useWriteModeStore.getState().lock("prod");
    await expect(
      invoke("update_row", { connectionString: stale, kind: "postgres" }),
    ).rejects.toThrow(LOCKED);
    await expect(
      invoke("execute_query", {
        connectionString: stale,
        kind: "postgres",
        sql: "UPDATE t SET a = 1",
      }),
    ).rejects.toThrow(LOCKED);
    expect(invocations).not.toContain("update_row");
  });

  test("mysql: Zeichenfolge mit anderem Passwort wird erkannt", async () => {
    useSettingsStore.setState({ productionReadOnly: true });
    const prod = connection("prod", "mysql", "mysql://app@db.example.com:3306/shop", {
      environment: "production",
    });
    useConnectionsStore.setState({ connections: [prod] });
    await expect(
      invoke("drop_table", {
        connectionString: "mysql://app:old%20secret@db.example.com:3306/shop",
        kind: "mysql",
      }),
    ).rejects.toThrow(LOCKED);
    expect(invocations).not.toContain("drop_table");
  });

  test("andere Server bleiben unberührt", async () => {
    useSettingsStore.setState({ productionReadOnly: true });
    const prod = connection("prod", "mysql", "mysql://app@db.example.com:3306/shop", {
      environment: "production",
    });
    useConnectionsStore.setState({ connections: [prod] });
    await invoke("drop_table", {
      connectionString: "mysql://app@db.example.com:3306/other",
      kind: "mysql",
    });
    await invoke("drop_table", {
      connectionString: "mysql://app@other.example.com:3306/shop",
      kind: "mysql",
    });
    expect(invocations.filter((entry) => entry === "drop_table")).toHaveLength(2);
  });
});

describe("Lesemodus bei veralteter Verbindungszeichenfolge", () => {
  test("schreibgeschützte Verbindung blockiert auch bei anderem Passwort", async () => {
    const readOnly = connection("ro", "postgres", "postgres://app@db.example.com:5432/shop", {
      readOnly: true,
    });
    const other = connection("other", "postgres", "postgres://app@other.example.com:5432/shop");
    useConnectionsStore.setState({ connections: [readOnly, other], activeId: "other" });
    await expect(
      invoke("update_row", {
        connectionString: "postgres://app:stale@db.example.com:5432/shop",
        kind: "postgres",
      }),
    ).rejects.toThrow(READ_ONLY_MESSAGE);
    expect(invocations).not.toContain("update_row");
  });

  test("beschreibbares Profil neben schreibgeschütztem Profil bleibt nutzbar", async () => {
    const readOnly = connection("ro", "postgres", "postgres://app@db.example.com:5432/shop", {
      readOnly: true,
    });
    const writable = connection("rw", "postgres", "postgres://app@db.example.com:5432/shop");
    useConnectionsStore.setState({ connections: [readOnly, writable], activeId: "rw" });
    await invoke("update_row", {
      connectionString: effectiveConnectionString(writable),
      kind: "postgres",
    });
    expect(invocations).toContain("update_row");
  });
});

describe("Versionierung respektiert Schutzmechanismen", () => {
  const url = "mysql://app@db.example.com:3306/shop";

  test("versioning_run und versioning_run_fleet blockieren gesperrte Produktion", async () => {
    useSettingsStore.setState({ productionReadOnly: true });
    const prod = connection("prod", "mysql", url, { environment: "production" });
    useConnectionsStore.setState({ connections: [prod] });
    const request = { connection: { kind: "mysql", connectionString: url } };
    await expect(invoke("versioning_run", { request })).rejects.toThrow(LOCKED);
    await expect(
      invoke("versioning_run_fleet", {
        requests: [{ connection: { kind: "mysql", connectionString: "mysql://x@y/z" } }, request],
      }),
    ).rejects.toThrow(LOCKED);
    useWriteModeStore.getState().unlock("prod");
    await invoke("versioning_run", { request });
    expect(invocations).toEqual(["versioning_run"]);
  });

  test("versioning_run blockiert schreibgeschützte Verbindung", async () => {
    const readOnly = connection("ro", "postgres", "postgres://app@db.example.com:5432/shop", {
      readOnly: true,
    });
    useConnectionsStore.setState({ connections: [readOnly] });
    await expect(
      invoke("versioning_run", {
        request: { connection: { connectionString: effectiveConnectionString(readOnly) } },
      }),
    ).rejects.toThrow(READ_ONLY_MESSAGE);
  });
});

import { afterEach, describe, expect, mock, test } from "bun:test";

const calls: { command: string; args: Record<string, unknown> }[] = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    if (command === "list_transactions") return [];
    if (command === "execute_query" || command === "execute_query_with_params")
      return { columns: [], rows: [], rows_affected: null, execution_time_ms: 1 };
    if (command === "community_extension_store") return [];
    return null;
  },
  Channel: class {},
  Resource: class {},
  transformCallback: () => 0,
}));
mock.module("@tauri-apps/plugin-dialog", () => ({
  open: async () => null,
  save: async () => null,
}));
mock.module("@tauri-apps/plugin-fs", () => ({
  readTextFile: async () => "",
  writeTextFile: async () => undefined,
}));

const { isWriteQuery } = await import("../src/lib/extensions/manager/is-write-query");
const { bindQueryParams } = await import("../src/lib/extensions/query-params");
const { ExtensionManager } = await import("../src/lib/extensions/manager");
const { validateArchive } = await import("../packages/extension-api/src/manifest");
const { useConnectionsStore } = await import("../src/lib/connections/store");
const { createExtensionHost } = await import("../src/lib/extensions/host");

import type {
  CoreServices,
  ExtensionArchive,
  ExtensionDescriptor,
  ExtensionRuntime,
  ExtensionStorage,
  InstalledExtension,
  Json,
  Permission,
  QueryRequest,
  RpcHandler,
} from "../src/lib/extensions/contracts";

afterEach(() => {
  calls.length = 0;
  useConnectionsStore.setState({ connections: [], activeId: null });
});

describe("isWriteQuery erkennt versteckte Schreibzugriffe", () => {
  const writes: [string, string][] = [
    ["postgres", "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d"],
    ["postgres", "SELECT * INTO t2 FROM t"],
    ["postgres", "EXPLAIN ANALYZE DELETE FROM t"],
    ["postgres", "EXPLAIN (ANALYZE, BUFFERS) UPDATE t SET a = 1"],
    ["mysql", "SELECT * FROM t INTO OUTFILE '/tmp/x'"],
    ["mysql", "SELECT a INTO @v FROM t"],
    ["mssql", "SELECT * INTO dbo.copy FROM dbo.t"],
    ["sqlite", "WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x"],
    ["duckdb", "SELECT 1; DROP TABLE t"],
    ["mongodb", "db.users.deleteMany({})"],
    ["redis", "DEL user:1"],
  ];
  for (const [kind, sql] of writes)
    test(`${kind}: ${sql}`, () => {
      expect(isWriteQuery(sql, kind)).toBe(true);
      expect(isWriteQuery(sql)).toBe(true);
    });

  const reads: [string, string][] = [
    ["postgres", "SELECT * FROM t WHERE note = 'delete me'"],
    ["postgres", "WITH x AS (SELECT 1) SELECT * FROM x"],
    ["postgres", "EXPLAIN SELECT * FROM t"],
    ["mysql", "SHOW TABLES"],
    ["mssql", "SELECT TOP 10 * FROM dbo.t"],
  ];
  for (const [kind, sql] of reads)
    test(`${kind}: ${sql} bleibt lesend`, () => {
      expect(isWriteQuery(sql, kind)).toBe(false);
    });
});

describe("bindQueryParams behält Zahlen und Wahrheitswerte", () => {
  const input = [42, 1.5, -3, true, false, null, "x", ""];
  test("postgres und duckdb", () => {
    for (const kind of ["postgres", "duckdb"])
      expect(bindQueryParams(input, kind)).toEqual([
        "42",
        "1.5",
        "-3",
        "true",
        "false",
        null,
        "x",
        "",
      ]);
  });
  test("mysql, mssql, sqlite, oracle, clickhouse", () => {
    for (const kind of ["mysql", "mssql", "sqlite", "oracle", "clickhouse"])
      expect(bindQueryParams(input, kind)).toEqual(["42", "1.5", "-3", "1", "0", null, "x", ""]);
  });
});

class MemoryStorage implements ExtensionStorage {
  entries = new Map<string, InstalledExtension>();
  async list() {
    return structuredClone([...this.entries.values()]);
  }
  async install(value: ExtensionArchive) {
    this.entries.set(value.manifest.id, {
      archive: value,
      enabled: false,
      grants: [],
      configuration: {},
    });
  }
  async replace(id: string, value: ExtensionArchive) {
    const entry = this.entries.get(id) as InstalledExtension;
    entry.archive = value;
    entry.grants = entry.grants.filter(
      (grant) => value.manifest.permissions?.includes(grant) ?? false,
    );
  }
  async remove(id: string) {
    this.entries.delete(id);
  }
  async update(
    id: string,
    enabled: boolean,
    grants: Permission[],
    configuration: Record<string, Json>,
  ) {
    Object.assign(this.entries.get(id) as InstalledExtension, { enabled, grants, configuration });
  }
  async get() {
    return null;
  }
  async set() {}
  async secretGet() {
    return null;
  }
  async secretSet() {}
  async secretDelete() {}
}

class TestRuntime implements ExtensionRuntime {
  rpc = new Map<string, RpcHandler>();
  async load(extension: ExtensionDescriptor, rpc: RpcHandler) {
    this.rpc.set(extension.archive.manifest.id, rpc);
  }
  async activate() {}
  async deactivate() {}
  async unload(id: string) {
    this.rpc.delete(id);
  }
  async execute() {
    return null;
  }
  event() {}
}

function capableArchive(version: string, hosts: string[], commands: string[]): ExtensionArchive {
  return validateArchive({
    format: 1,
    manifest: {
      id: "test.cap",
      publisher: "test",
      name: "Cap",
      version,
      engines: { l8db: ">=0.1.0 <2.0.0" },
      main: "dist/extension.js",
      activationEvents: ["onStartup"],
      permissions: ["database:read", "database:write", "network", "process:execute"],
      capabilities: { network: { hosts }, process: { commands } },
    },
    files: { "dist/extension.js": "exports.activate = () => {}" },
  });
}

function managerWith(queries: QueryRequest[] = []) {
  const storage = new MemoryStorage();
  const runtime = new TestRuntime();
  const core = {
    database: () => ({ connectionId: "c1", name: "db", kind: "postgres" }),
    query: async (request: QueryRequest) => {
      queries.push(request);
      return { columns: [], rows: [], rowsAffected: null, executionTimeMs: 1 };
    },
  } as unknown as CoreServices;
  return { storage, runtime, manager: new ExtensionManager(storage, runtime, core, "0.1.0") };
}

describe("Erweiterungs-Update fordert neue Zustimmung für erweiterte Fähigkeiten", () => {
  const all: Permission[] = ["database:read", "network", "process:execute"];

  test("neue Hosts entziehen die Netzwerkfreigabe", async () => {
    const { manager, storage } = managerWith();
    await manager.installExtension(capableArchive("1.0.0", ["api.example.com"], ["git"]));
    await manager.enableExtension("test.cap", all);
    await manager.updateExtension(
      capableArchive("1.1.0", ["api.example.com", "evil.example.net"], ["git"]),
    );
    const updated = manager.listExtensions()[0];
    expect(updated.grants).toEqual(["database:read", "process:execute"]);
    expect(storage.entries.get("test.cap")?.grants).toEqual(["database:read", "process:execute"]);
  });

  test("neue Befehle entziehen die Prozessfreigabe", async () => {
    const { manager, storage } = managerWith();
    await manager.installExtension(capableArchive("1.0.0", ["api.example.com"], ["git"]));
    await manager.enableExtension("test.cap", all);
    await manager.updateExtension(capableArchive("1.1.0", ["api.example.com"], ["git", "sh"]));
    expect(manager.listExtensions()[0].grants).toEqual(["database:read", "network"]);
    expect(storage.entries.get("test.cap")?.grants).toEqual(["database:read", "network"]);
  });

  test("gleiche oder engere Fähigkeiten behalten die Freigaben", async () => {
    const { manager } = managerWith();
    await manager.installExtension(
      capableArchive("1.0.0", ["api.example.com", "b.example.com"], ["git", "sh"]),
    );
    await manager.enableExtension("test.cap", all);
    await manager.updateExtension(capableArchive("1.1.0", ["b.example.com"], ["git"]));
    expect(manager.listExtensions()[0].grants).toEqual(all);
  });
});

describe("database.query", () => {
  test("Parameter erreichen den Host unverändert", async () => {
    const queries: QueryRequest[] = [];
    const { manager, runtime } = managerWith(queries);
    await manager.installExtension(capableArchive("1.0.0", ["api.example.com"], ["git"]));
    await manager.enableExtension("test.cap", ["database:read"]);
    await manager.activate("test.cap");
    const rpc = runtime.rpc.get("test.cap") as RpcHandler;
    await rpc("database.query", ["SELECT * FROM t WHERE id = $1 AND active = $2", [42, true]]);
    expect(queries[0].params).toEqual([42, true]);
    await expect(
      rpc("database.query", ["WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d"]),
    ).rejects.toThrow();
    expect(queries).toHaveLength(1);
  });

  test("Host bindet Zahlen und erzwingt Lesemodus für Postgres-Lesezugriffe", async () => {
    useConnectionsStore.setState({
      connections: [
        {
          id: "c1",
          name: "Shop",
          kind: "postgres",
          sslMode: "prefer",
          connectionString: "postgres://app@db.example.com:5432/shop",
        } as never,
      ],
      activeId: "c1",
    });
    const host = createExtensionHost();
    const core = (host.manager as unknown as { core: CoreServices }).core;
    await core.query({ sql: "SELECT setval('s', $1)", params: [42, false], write: false });
    const read = calls.find((call) => call.command === "execute_query_with_params");
    expect(read?.args.params).toEqual(["42", "false"]);
    expect(String(read?.args.connectionString)).toContain("default_transaction_read_only");
    calls.length = 0;
    await core.query({ sql: "UPDATE t SET a = 1", write: true });
    const write = calls.find((call) => call.command === "execute_query");
    expect(String(write?.args.connectionString)).not.toContain("default_transaction_read_only");
  });
});

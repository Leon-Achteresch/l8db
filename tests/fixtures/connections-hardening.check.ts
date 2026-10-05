import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const calls: { command: string; args: Record<string, unknown> }[] = [];
const keychain = new Map<string, string>();
const otherWindowConnections = new Set<string>();

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    if (command === "list_providers") return [];
    if (command === "connection_in_other_window")
      return otherWindowConnections.has(String(args.id));
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

const { extractUrlPassword, injectUrlPassword, scrubUrlPassword } = await import(
  "../../src/lib/secrets"
);
const { initConnectionSecrets, useConnectionsStore, visibleSchemas } = await import(
  "../../src/lib/connections"
);
const { parseConnectionImport } = await import("../../src/lib/connection-export");
const { KINDS } = await import("../../src/lib/connection-export/types");
const { mergeVaultConnections } = await import("../../src/lib/connection-export/vault");
const { isAuthFailure, connectionError, updateOracleConnectionTarget } = await import(
  "../../src/lib/connection-url"
);
const { matchingHostRule, groupByServer } = await import("../../src/lib/connection-groups");
const { databasePasswordToSave, closeUnsharedTunnel } = await import(
  "../../src/features/connections/connection-editor/connection-operations"
);
const { schemaForUser } = await import(
  "../../src/features/connections/connections-view/set-schemas-to-user"
);
const { connectionRemovalBlocker, unsavedQueryTabCount } = await import(
  "../../src/features/connections/connections-view/connection-removal"
);
const { useTableTabs } = await import("../../src/lib/table-tabs");
const { useTransactionStore } = await import("../../src/lib/transactions");

const flush = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
  calls.length = 0;
  otherWindowConnections.clear();
});

describe("key-value connection strings keep their password", () => {
  const cases = [
    {
      value: "User Id=scott;Password=tiger;Data Source=db:1521/ORCL",
      password: "tiger",
    },
    {
      value: 'Server=db.internal;Database=shop;User Id=sa;Password="se;c""ret"',
      password: 'se;c"ret',
    },
    {
      value: "Driver={ODBC Driver 18 for SQL Server};Server=db;UID=sa;PWD={p;w}}x}",
      password: "p;w}x",
    },
    {
      value: "host=db password=s3cret user=bob dbname=app",
      password: "s3cret",
    },
    {
      value: "host=db password='with space' user=bob dbname=app",
      password: "with space",
    },
  ];

  test("extract, scrub and inject round-trip for every key-value dialect", () => {
    for (const entry of cases) {
      expect(extractUrlPassword(entry.value)).toBe(entry.password);
      const scrubbed = scrubUrlPassword(entry.value);
      expect(scrubbed).not.toContain(entry.password);
      expect(extractUrlPassword(scrubbed)).toBeNull();
      const restored = injectUrlPassword(scrubbed, entry.password);
      expect(extractUrlPassword(restored)).toBe(entry.password);
      expect(scrubUrlPassword(restored)).toBe(scrubbed);
    }
    const dsn = scrubUrlPassword("host=db password=s3cret user=bob dbname=app");
    expect(dsn).toBe("host=db password=*** user=bob dbname=app");
    expect(injectUrlPassword("host=db password=*** user=bob", "a b'c")).toBe(
      "host=db password='a b\\'c' user=bob",
    );
  });

  test("other password-like keys are scrubbed but never taken as the login password", () => {
    const value = "User Id=scott;Proxy Password=proxy-secret;Password=tiger;Data Source=db/svc";
    expect(extractUrlPassword(value)).toBe("tiger");
    const scrubbed = scrubUrlPassword(value);
    expect(scrubbed).not.toContain("proxy-secret");
    expect(scrubbed).not.toContain("tiger");
  });

  test("a restart restores the keychain password instead of overwriting it with ***", async () => {
    keychain.set("kv", "tiger");
    storage.set(
      "l8db.connections",
      JSON.stringify({
        state: {
          connections: [
            {
              id: "kv",
              name: "ODP",
              kind: "oracle",
              connectionString: "User Id=scott;Password=***;Data Source=db:1521/ORCL",
              sslMode: "prefer",
            },
          ],
        },
        version: 0,
      }),
    );
    await useConnectionsStore.persist.rehydrate();
    await initConnectionSecrets();
    expect(keychain.get("kv")).toBe("tiger");
    const connection = useConnectionsStore.getState().connections.find((c) => c.id === "kv");
    expect(extractUrlPassword(connection?.connectionString ?? "")).toBe("tiger");
    await flush();
    expect(storage.get("l8db.connections")).not.toContain("tiger");
  });

  test("vault entries with key-value strings get their password injected", () => {
    const merge = mergeVaultConnections(
      [
        {
          id: "vault-kv",
          name: "Vault KV",
          kind: "mssql",
          connectionString: "Server=db;User Id=sa;Password=***",
          password: "pw;1",
          profile: {
            id: "vault-kv",
            name: "Vault KV",
            kind: "mssql",
            connectionString: "Server=db;User Id=sa;Password=***",
            sslMode: "prefer",
          },
        },
      ],
      [],
    );
    expect(merge.skipped).toEqual([]);
    expect(extractUrlPassword(merge.added[0].connectionString)).toBe("pw;1");
  });
});

describe("connection import knows every database kind", () => {
  test("every Rust DatabaseKind variant can be imported", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../src-tauri/src/db/provider.rs"),
      "utf8",
    );
    const body = /pub enum DatabaseKind \{([^}]*)\}/.exec(source)?.[1] ?? "";
    const variants = body
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase());
    expect(variants).toContain("s3");
    expect([...KINDS].sort()).toEqual([...variants].sort());
  });

  test("an exported S3 connection imports without an error", () => {
    const parsed = parseConnectionImport(
      JSON.stringify({
        format: "l8db-connections",
        version: 1,
        connections: [
          {
            id: "minio",
            name: "MinIO",
            kind: "s3",
            connectionString: "s3://minioadmin@127.0.0.1:9000/?region=us-east-1",
            sslMode: "disable",
          },
        ],
      }),
      [],
    );
    expect(parsed.candidates[0].error ?? null).toBeNull();
    expect(parsed.candidates[0].profile?.kind).toBe("s3");
  });
});

describe("authorization errors are not login failures", () => {
  test("only real login failures trigger the password prompt", () => {
    const loginFailures = [
      "Server error: `ERROR 28000 (1045): Access denied for user 'root'@'172.17.0.1' (using password: YES)'",
      "ERROR 1698 (28000): Access denied for user 'root'@'localhost'",
      'password authentication failed for user "app"',
      "SQLSTATE 28P01",
      "Login failed for user 'sa'.",
      "ORA-01017: invalid username/password; logon denied",
      "WRONGPASS invalid username-password pair",
      "MongoDB: Authentication failed.",
      "Code: 516. DB::Exception: default: Authentication failed: password is incorrect",
    ];
    for (const message of loginFailures) expect(isAuthFailure(message)).toBe(true);
    const permissionErrors = [
      "ERROR 1227 (42000): Access denied; you need (at least one of) the PROCESS privilege(s) for this operation",
      "ERROR 1044 (42000): Access denied for user 'app'@'%' to database 'secret'",
      "BigQuery 403: Access Denied: Project proj",
      "ERROR 1142 (42000): SELECT command denied to user 'app'@'localhost' for table 'x'",
    ];
    for (const message of permissionErrors) {
      expect(isAuthFailure(message)).toBe(false);
      expect(connectionError(message)).not.toContain("Anmeldung fehlgeschlagen");
    }
  });
});

describe("host group patterns", () => {
  const connection = (url: string) => ({ kind: "postgres" as const, connectionString: url });

  test("a host pattern does not match the port or database", () => {
    const rules = [
      { id: "dev", name: "Dev", pattern: "*dev*", environment: "development" as const },
      { id: "prod", name: "Prod", pattern: "prod*", environment: "production" as const },
    ];
    expect(matchingHostRule(connection("postgres://u@prod-db1:5432/devices"), rules)?.id).toBe(
      "prod",
    );
    expect(matchingHostRule(connection("postgres://u@dev-db1:5432/app"), rules)?.id).toBe("dev");
    expect(
      matchingHostRule(connection("postgres://u@db1:5433/app"), [
        { id: "port", name: "Port", pattern: "*:5432*" },
      ]),
    ).toBeUndefined();
  });

  test("patterns with a port or database still match the endpoint", () => {
    const rules = [{ id: "ep", name: "Endpoint", pattern: "db1:5432/*" }];
    expect(matchingHostRule(connection("postgres://u@db1:5432/app"), rules)?.id).toBe("ep");
    expect(matchingHostRule(connection("postgres://u@db1:5433/app"), rules)).toBeUndefined();
    const groups = groupByServer(
      [
        { id: "a", name: "a", ...connection("postgres://u@cslbl01.corp:5432/db") },
        { id: "b", name: "b", ...connection("postgres://u@other:5432/cslbl") },
      ] as never,
      [{ id: "r", name: "CSL", pattern: "cslbl*" }],
    );
    expect(groups.map((group) => group.connections.length)).toEqual([1, 1]);
  });
});

describe("editor password handling", () => {
  test("clearing the password field removes the stored password", async () => {
    keychain.set("edit", "old-secret");
    const existing = { id: "edit", connectionString: "postgresql://app:old-secret@db/app" };
    expect(await databasePasswordToSave("postgresql://app@db/app", existing)).toBeNull();
    expect(await databasePasswordToSave("postgresql://app:new@db/app", existing)).toBe("new");
  });

  test("an editor seeded without the password keeps the keychain password", async () => {
    keychain.set("locked", "kept");
    const existing = { id: "locked", connectionString: "postgresql://app@db/app" };
    expect(await databasePasswordToSave("postgresql://app@db/app", existing)).toBe("kept");
    expect(await databasePasswordToSave("postgresql://app@db/app", undefined)).toBeNull();
  });
});

describe("tunnels shared with other windows", () => {
  test("saving keeps a tunnel that another window still uses", async () => {
    otherWindowConnections.add("shared");
    await closeUnsharedTunnel("shared");
    await closeUnsharedTunnel("solo");
    const closed = calls.filter((call) => call.command === "close_ssh_tunnel");
    expect(closed.map((call) => call.args.id)).toEqual(["solo"]);
  });

  test("removing a connection keeps a tunnel another window still uses", async () => {
    useConnectionsStore.setState({
      connections: [
        {
          id: "rm-shared",
          name: "s",
          kind: "postgres",
          connectionString: "postgresql://u@h/db",
          sslMode: "prefer",
        },
        {
          id: "rm-solo",
          name: "t",
          kind: "postgres",
          connectionString: "postgresql://u@h/db2",
          sslMode: "prefer",
        },
      ],
    });
    otherWindowConnections.add("rm-shared");
    useConnectionsStore.getState().removeConnection("rm-shared");
    useConnectionsStore.getState().removeConnection("rm-solo");
    await flush();
    await flush();
    const closed = calls.filter((call) => call.command === "close_ssh_tunnel");
    expect(closed.map((call) => call.args.id)).toEqual(["rm-solo"]);
  });

  test("a connection active in another window cannot be removed", async () => {
    otherWindowConnections.add("busy");
    expect(await connectionRemovalBlocker(["busy"])).toContain("anderen Fenster");
    expect(await connectionRemovalBlocker(["free", "busy"])).toContain("anderen Fenster");
    expect(await connectionRemovalBlocker(["free"])).toBeNull();
    useTransactionStore.setState({
      transactions: [{ connectionId: "free" } as never],
    });
    expect(await connectionRemovalBlocker(["free"])).toContain("Transaktion");
    useTransactionStore.setState({ transactions: [] });
  });
});

describe("removing connections warns about unsaved query tabs", () => {
  test("counts query tabs with unsaved SQL of active and inactive connections", () => {
    useConnectionsStore.setState({ activeId: "active" });
    useTableTabs.setState({
      tabs: [
        { kind: "query", id: "q1", title: "Query 1", sql: "delete from t" },
        { kind: "query", id: "q2", title: "Query 2", sql: "  " },
        { kind: "table", schema: "public", table: "t" },
      ],
      tabsByConnection: {
        idle: [
          { kind: "query", id: "q3", title: "Query 3", sql: "update t set a = 1" },
          {
            kind: "query",
            id: "q4",
            title: "saved.sql",
            sql: "select 2",
            filePath: "/tmp/saved.sql",
            savedSql: "select 2",
          },
        ],
      },
    });
    expect(unsavedQueryTabCount(["active"])).toBe(1);
    expect(unsavedQueryTabCount(["idle"])).toBe(1);
    expect(unsavedQueryTabCount(["active", "idle", "none"])).toBe(2);
    useConnectionsStore.setState({ activeId: null });
  });
});

describe("schema filter set to the username", () => {
  test("Oracle usernames map to the uppercase schema", () => {
    expect(schemaForUser({ kind: "oracle", connectionString: "oracle://hr@db:1521/ORCL" })).toBe(
      "HR",
    );
    expect(schemaForUser({ kind: "postgres", connectionString: "postgresql://Alice@db/app" })).toBe(
      "Alice",
    );
  });

  test("schema filters match case-insensitively only when no exact match exists", () => {
    expect(visibleSchemas({ schemas: ["hr"] }, ["HR", "SYS"])).toEqual(["HR"]);
    expect(visibleSchemas({ schemas: ["foo"] }, ["foo", "FOO"])).toEqual(["foo"]);
    expect(visibleSchemas({ schemas: ["Sales", "hr"] }, ["SALES", "Sales", "HR"])).toEqual([
      "Sales",
      "HR",
    ]);
  });
});

describe("bulk endpoint edit", () => {
  const ssh = {
    host: "bastion",
    port: 22,
    user: "ops",
    auth: "key" as const,
    remoteHost: "old.example.com",
    remotePort: 1521,
  };

  test("a new port is applied to the SSH tunnel target", () => {
    const updated = updateOracleConnectionTarget(
      { connectionString: "oracle://SCOTT@old.example.com:1521/ORCL", ssh },
      "new.example.com:1522",
      "ORCLPDB",
    );
    expect(updated.connectionString).toBe("oracle://SCOTT@new.example.com:1522/ORCLPDB");
    expect(updated.ssh).toEqual({ ...ssh, remoteHost: "new.example.com", remotePort: 1522 });
  });

  test("a host without a port keeps the tunnel port", () => {
    const updated = updateOracleConnectionTarget(
      { connectionString: "oracle://SCOTT@old.example.com:1521/ORCL", ssh },
      "[2001:db8::10]",
      "ORCL",
    );
    expect(updated.ssh).toEqual({ ...ssh, remoteHost: "2001:db8::10", remotePort: 1521 });
    expect(
      updateOracleConnectionTarget(
        { connectionString: "oracle://SCOTT@old.example.com:1521/ORCL", ssh: null },
        "x:1600",
        "ORCL",
      ).ssh,
    ).toBeNull();
  });
});

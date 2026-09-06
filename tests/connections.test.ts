import { beforeEach, describe, expect, mock, test } from "bun:test";

const calls: string[] = [];
let rejectConnection = false;
let keychainUnavailable = false;
let sequence = 6000;
const keychain = new Map<string, string>();

function provider(
  id: string,
  kind: string,
  schemes: string[],
  hosts: string[],
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    name: id,
    group: kind,
    kind,
    default_port: 5432,
    file_based: false,
    url_schemes: schemes,
    placeholder: "",
    hint: "",
    hosts,
    driver: { type: "builtin" },
    capabilities: { ssl: true, ssh: true, views: true },
    driver_status: { available: true, detail: "", install: [] },
    ...extra,
  };
}

const PROVIDERS = [
  provider("postgres", "postgres", ["postgresql", "postgres"], ["localhost", "127.0.0.1"]),
  provider("supabase", "postgres", ["postgresql", "postgres"], [".supabase.co", ".supabase.com"]),
  provider("neon", "postgres", ["postgresql", "postgres"], [".neon.tech"]),
  provider("cloud-postgres", "postgres", ["postgresql", "postgres"], [".rds.amazonaws.com"]),
  provider("mysql", "mysql", ["mysql", "mariadb"], ["localhost"], { default_port: 3306 }),
  provider("sqlite", "sqlite", ["sqlite", "file"], [], { default_port: null, file_based: true }),
  provider("redis", "redis", ["redis", "rediss"], ["localhost"], { default_port: 6379 }),
  provider("oracle", "oracle", ["oracle"], ["localhost"], { default_port: 1521 }),
];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    calls.push(command);
    if (command === "list_providers") return PROVIDERS;
    if (command === "test_connection_string" && rejectConnection)
      throw new Error("password authentication failed");
    if (command === "open_ssh_tunnel") return { local_port: ++sequence };
    if (command === "list_ssh_tunnels") return [];
    if (command.endsWith("secret")) {
      if (keychainUnavailable) throw new Error("Keychain unavailable");
      if (command === "store_secret") keychain.set(String(args.account), String(args.secret));
      if (command === "load_secret") return keychain.get(String(args.account)) ?? null;
      if (command === "delete_secret") keychain.delete(String(args.account));
    }
  },
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

const { loadProviders } = await import("../src/lib/providers");
await loadProviders();
const { useConnectionsStore } = await import("../src/lib/connections");
const { useTransactionStore } = await import("../src/lib/transactions");
const {
  parseConnectionUrl,
  detectProvider,
  connectionError,
  connectionSummary,
  kindFromUrl,
  isOracleKeyValue,
} = await import("../src/lib/connection-url");
const {
  withSslModeParam,
  extractUrlPassword,
  scrubUrlPassword,
  storeSecret,
  loadSecret,
  deleteSecret,
} = await import("../src/lib/secrets");
const { effectiveConnectionString, activateConnection, tunneledConnectionString } = await import(
  "../src/lib/ssh"
);

const direct = {
  id: "direct",
  name: "Local",
  kind: "postgres" as const,
  connectionString: "postgresql://user:p%40ss@localhost:5432/app?sslmode=disable",
  sslMode: "disable" as const,
};
const tunneled = {
  ...direct,
  id: "ssh",
  ssh: {
    host: "bastion.example.com",
    port: 22,
    user: "root",
    auth: "key" as const,
    keyFile: "/tmp/test-key",
    remoteHost: "db.internal",
    remotePort: 5434,
  },
};

beforeEach(() => {
  calls.length = 0;
  rejectConnection = false;
  keychainUnavailable = false;
  useConnectionsStore.setState({ connections: [direct, tunneled], activeId: null });
  useTransactionStore.setState({ transactions: [] });
});

describe("PostgreSQL URLs", () => {
  test("replaces SSL while preserving encoded options and credentials", () => {
    const url = withSslModeParam(
      "postgres://user:p+ass@host/app?sslmode=disable&options=-c%20search_path%3Dpublic&application_name=a+b",
      "verify-full",
    );
    expect(url).toContain("sslmode=verify-full");
    expect(url).not.toContain("sslmode=disable");
    expect(url).toContain("options=-c%20search_path%3Dpublic");
    expect(url).toContain("application_name=a+b");
    expect(extractUrlPassword(url)).toBe("p+ass");
  });
  test("rejects malformed URLs, unsafe endpoint overrides and invalid SSL", () => {
    for (const url of [
      "https://host/app",
      "postgres://user@host",
      "postgres://user@host/app?hostaddr=10.0.0.1",
      "postgres://user@host/app?sslmode=wrong",
      "postgres://user:p%ZZ@host/app",
    ])
      expect(() => parseConnectionUrl(url)).toThrow();
  });
  test("identifies actual provider domains", () => {
    expect(detectProvider("postgres://user@db.example.supabase.co/postgres")).toBe("supabase");
    expect(detectProvider("postgres://user@ep-example.neon.tech/neondb")).toBe("neon");
    expect(detectProvider("postgres://user@fake-supabase.co/app")).toBe("cloud-postgres");
    expect(detectProvider("postgres://user@localhost/app")).toBe("postgres");
  });
  test("preserves the hostname for TLS and all URL options through SSH", () => {
    const result = tunneledConnectionString(
      "postgres://user@db.internal:5434/app?sslmode=verify-full&options=-c%20search_path%3Dpublic",
      6500,
    );
    expect(result).toContain("@db.internal:6500/");
    expect(result).toContain("hostaddr=127.0.0.1");
    expect(result).toContain("options=-c%20search_path%3Dpublic");
    expect(() => effectiveConnectionString(tunneled)).toThrow("SSH-Tunnel");
  });
});

describe("Other providers", () => {
  test("detects the driver family from the URL scheme or a file path", () => {
    expect(kindFromUrl("mysql://root@localhost/db")).toBe("mysql");
    expect(kindFromUrl("redis://localhost:6379/0")).toBe("redis");
    expect(kindFromUrl("/tmp/app.db")).toBe("sqlite");
    expect(kindFromUrl("C:\\data\\app.sqlite")).toBe("sqlite");
    expect(kindFromUrl("nope://x")).toBeUndefined();
  });
  test("validates per family and normalizes file paths", () => {
    expect(parseConnectionUrl("redis://localhost:6379/0").hostname).toBe("localhost");
    expect(() => parseConnectionUrl("mysql://localhost/db")).toThrow("Benutzer");
    expect(() => parseConnectionUrl("mysql://root@localhost/db", "postgres")).toThrow(
      "postgresql://",
    );
    expect(parseConnectionUrl("/tmp/app.db").toString()).toBe("sqlite:/tmp/app.db");
    expect(parseConnectionUrl("sqlite:///tmp/app.db").toString()).toBe("sqlite:/tmp/app.db");
    expect(parseConnectionUrl(":memory:", "sqlite").toString()).toBe("sqlite::memory:");
    expect(() => parseConnectionUrl("relative.db", "sqlite")).toThrow("absoluten");
  });
  test("summarizes endpoints and file databases", () => {
    expect(connectionSummary("mysql://root@db.example.com/shop")).toEqual({
      host: "db.example.com",
      port: "3306",
      database: "shop",
      user: "root",
    });
    expect(connectionSummary("/tmp/app.db", "sqlite")).toEqual({
      host: "app.db",
      port: "",
      database: "/tmp/app.db",
      user: "",
    });
  });
  test("rewrites host and port for tunneled non-PostgreSQL URLs", () => {
    expect(
      tunneledConnectionString("mysql://u:p@db.internal:3306/app?ssl-mode=required", 6500, "mysql"),
    ).toBe("mysql://u:p@127.0.0.1:6500/app?ssl-mode=required");
    expect(tunneledConnectionString("redis://db.internal/0", 6501, "redis")).toBe(
      "redis://127.0.0.1:6501/0",
    );
  });
  test("redacts credentials of any scheme and maps foreign auth errors", () => {
    expect(connectionError("Failed mysql://user:secret@host/app")).not.toContain("secret");
    expect(connectionError("Access denied for user 'root'@'localhost'")).toContain("Anmeldung");
    expect(connectionError("ORA-01017: invalid username/password")).toContain("Anmeldung");
  });
});

describe("Connection lifecycle", () => {
  test("saving never activates an untested connection or persists a password", () => {
    useConnectionsStore.getState().addConnection({ ...direct, name: "New" });
    expect(useConnectionsStore.getState().activeId).toBeNull();
    const persisted = storage.get("l8db.connections")!;
    expect(persisted).not.toContain("p%40ss");
    expect(scrubUrlPassword(direct.connectionString)).toContain("user@localhost");
  });
  test("activation tests credentials before setting the active connection", async () => {
    expect((await activateConnection("direct")).ok).toBe(true);
    expect(calls).toContain("test_connection_string");
    expect(useConnectionsStore.getState().activeId).toBe("direct");
  });
  test("failed authentication preserves the previous selection", async () => {
    useConnectionsStore.setState({ activeId: "direct" });
    rejectConnection = true;
    expect((await activateConnection("ssh")).ok).toBe(false);
    expect(useConnectionsStore.getState().activeId).toBe("direct");
    expect(calls).toContain("close_ssh_tunnel");
    expect(
      useConnectionsStore.getState().connections.find((entry) => entry.id === "ssh")?.tunnelPort,
    ).toBeNull();
  });
  test("a new SSH connection opens its tunnel before testing PostgreSQL", async () => {
    expect((await activateConnection("ssh")).ok).toBe(true);
    expect(calls.indexOf("open_ssh_tunnel")).toBeLessThan(calls.indexOf("test_connection_string"));
    expect(
      useConnectionsStore.getState().connections.find((entry) => entry.id === "ssh")?.tunnelPort,
    ).toBeGreaterThan(0);
    expect(storage.get("l8db.connections")).toContain('"tunnelPort":null');
  });
  test("open transactions prevent a disconnect", async () => {
    useConnectionsStore.setState({ activeId: "direct" });
    useTransactionStore.setState({
      transactions: [
        {
          txId: "tx_1",
          connectionId: "direct",
          connectionName: "Local",
          changes: [],
          startedAt: 0,
        },
      ],
    });
    expect((await activateConnection(null)).ok).toBe(false);
    expect(useConnectionsStore.getState().activeId).toBe("direct");
  });
  test("serializes competing activation requests", async () => {
    await Promise.all([activateConnection("ssh"), activateConnection("direct")]);
    expect(useConnectionsStore.getState().activeId).toBe("direct");
    expect(calls).toContain("close_ssh_tunnel");
  });
  test("keeps secrets in memory when the keychain is unavailable", async () => {
    keychainUnavailable = true;
    await expect(storeSecret("session-test", "secret")).rejects.toThrow();
    expect(await loadSecret("session-test")).toBe("secret");
    keychainUnavailable = false;
    await deleteSecret("session-test");
    expect(await loadSecret("session-test")).toBeNull();
  });
  test("error messages redact credentials", () => {
    expect(connectionError("Failed postgres://user:secret@host/app")).not.toContain("secret");
  });
});

describe("Oracle Key-Value", () => {
  const kv =
    "User Id=DEV_ACHTERESCH;Password=XXX;Data Source=csorastby.rzhit.win:1521/sltest.rzhit.win";
  test("detects ODP.NET strings as Oracle", () => {
    expect(isOracleKeyValue(kv)).toBe(true);
    expect(kindFromUrl(kv)).toBe("oracle");
    expect(detectProvider(kv, "oracle")).toBe("oracle");
  });
  test("normalizes to an oracle:// URL", () => {
    const url = parseConnectionUrl(kv);
    expect(url.protocol).toBe("oracle:");
    expect(url.hostname).toBe("csorastby.rzhit.win");
    expect(url.port).toBe("1521");
    expect(url.pathname).toBe("/sltest.rzhit.win");
    expect(decodeURIComponent(url.username)).toBe("DEV_ACHTERESCH");
    expect(extractUrlPassword(url.toString())).toBe("XXX");
  });
  test("accepts lowercase keys and defaults the port", () => {
    const raw = "user id=scott;pwd=tiger;data source=db.example.com/ORCLPDB";
    const url = parseConnectionUrl(raw);
    expect(url.hostname).toBe("db.example.com");
    expect(url.port).toBe("");
    expect(connectionSummary(raw)).toEqual({
      host: "db.example.com",
      port: "1521",
      database: "ORCLPDB",
      user: "scott",
    });
  });
  test("keeps quoted passwords with semicolons intact", () => {
    const url = parseConnectionUrl('User Id=scott;Password="a;b";Data Source=db:1521/svc');
    expect(url.password).toBe("a%3Bb");
    expect(extractUrlPassword(url.toString())).toBe("a;b");
  });
  test("extracts endpoints from TNS descriptors", () => {
    const descriptor =
      "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=db.example.com)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=ORCLPDB)))";
    const url = parseConnectionUrl(`User Id=scott;Password=tiger;Data Source=${descriptor}`);
    expect(url.hostname).toBe("db.example.com");
    expect(url.pathname).toBe("/ORCLPDB");
  });
  test("keeps TNS aliases via connect_string with explicit kind", () => {
    const url = parseConnectionUrl("User Id=scott;Password=tiger;Data Source=ORCL", "oracle");
    expect(url.searchParams.get("connect_string")).toBe("ORCL");
  });
  test("rejects MSSQL-style strings and incomplete input", () => {
    expect(kindFromUrl("Server=db.internal;Database=shop;User Id=sa;Password=secret")).toBeUndefined();
    expect(isOracleKeyValue("Server=db.internal;Database=shop;User Id=sa;Password=secret")).toBe(
      false,
    );
    expect(() => parseConnectionUrl("User Id=scott;Password=tiger")).toThrow();
    expect(() => parseConnectionUrl("Password=tiger;Data Source=db/svc")).toThrow();
  });
  test("redacts key-value passwords", () => {
    expect(connectionError(`Oracle: ${kv}`)).not.toContain("XXX");
    expect(connectionError(`Oracle: ${kv}`)).toContain("Password=***");
    expect(scrubUrlPassword(kv)).toBe(
      "User Id=DEV_ACHTERESCH;Password=***;Data Source=csorastby.rzhit.win:1521/sltest.rzhit.win",
    );
    expect(extractUrlPassword(kv)).toBe("XXX");
  });
});

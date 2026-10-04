import { beforeEach, describe, expect, mock, test } from "bun:test";

const syncCalls: unknown[][] = [];
const saved: unknown[] = [];
let settings = {
  schedulerEnabled: true,
  smtpProfiles: [],
  webhooks: [],
  defaultRetention: null,
  sshTrustNewHosts: false,
  backupToolPaths: {},
  defaultOutputDir: null,
  notifyNativeOnFailure: true,
  maxParallelRuns: null,
};

function provider(kind: string, schemes: string[], readOnly: boolean) {
  return {
    id: kind,
    name: kind,
    group: kind,
    kind,
    default_port: 5432,
    file_based: kind === "sqlite",
    url_schemes: schemes,
    placeholder: "",
    hint: "",
    hosts: ["localhost"],
    driver: { type: "builtin" },
    capabilities: { ssl: true, ssh: true, views: true, read_only_mode: readOnly },
    driver_status: { available: true, detail: "", install: [] },
  };
}

const PROVIDERS = [
  provider("postgres", ["postgresql", "postgres"], true),
  provider("mysql", ["mysql"], false),
  provider("sqlite", ["sqlite", "file"], false),
];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    if (command === "list_providers") return PROVIDERS;
    if (command === "automation_sync_connections") {
      syncCalls.push(args.connections as unknown[]);
      return null;
    }
    if (command === "automation_get_settings") return settings;
    if (command === "automation_save_settings") {
      saved.push(args.settings);
      settings = args.settings as typeof settings;
      return settings;
    }
    return null;
  },
  transformCallback: () => 1,
}));

mock.module("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    addEventListener: () => {},
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
const { useSettingsStore } = await import("../src/lib/settings");
const { useWriteModeStore } = await import("../src/lib/environments");
const {
  AUTOMATION_SYNC_DEBOUNCE_MS,
  buildAutomationConnection,
  buildAutomationConnections,
  initAutomationSync,
} = await import("../src/lib/automation/sync");

type Saved = Parameters<typeof buildAutomationConnection>[0];

const base: Saved = {
  id: "pg",
  name: "Produktion",
  kind: "postgres",
  connectionString:
    "postgres://admin:hunter2@db.example.com:5432/shop?sslmode=require&api_key=abc123",
  sslMode: "require",
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  useSettingsStore.setState({ productionReadOnly: true, sshTrustNewHosts: false });
  useWriteModeStore.setState({ unlockedUntil: {} });
});

describe("buildAutomationConnection", () => {
  test("Passwort und geheime Parameter fehlen im Descriptor", () => {
    const descriptor = buildAutomationConnection(base);
    expect(descriptor.connectionString).not.toContain("hunter2");
    expect(descriptor.connectionString).not.toContain("api_key");
    expect(descriptor.connectionString).not.toContain("abc123");
    expect(descriptor.connectionString).toContain("admin@db.example.com");
    expect(descriptor.connectionString).toContain("sslmode=require");
    expect(JSON.stringify(descriptor)).not.toContain("hunter2");
    expect(descriptor.readOnly).toBe(false);
    expect(descriptor.ssh).toBeNull();
    expect(descriptor.proxy).toBeNull();
    expect(descriptor.vault).toBe(false);
  });

  test("Schreibschutz setzt Option und readOnly", () => {
    const descriptor = buildAutomationConnection({ ...base, readOnly: true });
    expect(descriptor.readOnly).toBe(true);
    expect(decodeURIComponent(descriptor.connectionString)).toContain(
      "options=-c default_transaction_read_only=on",
    );
    expect(descriptor.connectionString).not.toContain("hunter2");
  });

  test("Production-Lock setzt Option und readOnly", () => {
    const production = { ...base, environment: "production" as const };
    const locked = buildAutomationConnection(production);
    expect(locked.readOnly).toBe(true);
    expect(locked.environment).toBe("production");
    expect(decodeURIComponent(locked.connectionString)).toContain(
      "default_transaction_read_only=on",
    );
    useSettingsStore.setState({ productionReadOnly: false });
    const unlocked = buildAutomationConnection(production);
    expect(unlocked.readOnly).toBe(false);
    expect(unlocked.connectionString).not.toContain("default_transaction_read_only");
  });

  test("Schreibschutz ohne Fähigkeit bleibt aus", () => {
    const mysql = buildAutomationConnection({
      ...base,
      id: "my",
      kind: "mysql",
      connectionString: "mysql://root:pw@localhost:3306/app",
      readOnly: true,
    });
    expect(mysql.readOnly).toBe(false);
    expect(mysql.connectionString).toBe("mysql://root@localhost:3306/app");
  });

  test("temporäre Verbindungen fehlen", () => {
    const list = buildAutomationConnections([
      base,
      { ...base, id: "tmp", name: "Datei", temporary: true },
    ]);
    expect(list.map((entry) => entry.id)).toEqual(["pg"]);
  });

  test("SSH und Proxy werden 1:1 übernommen, Tags als Namen", () => {
    const descriptor = buildAutomationConnection({
      ...base,
      tags: [
        { name: "kunde-a", color: "#fff" },
        { name: "prod", color: "#000" },
      ],
      vault: true,
      ssh: {
        host: "bastion.example.com",
        port: 2222,
        user: "deploy",
        auth: "key",
        keyFile: "~/.ssh/id_ed25519",
        jumpHosts: [{ host: "jump", port: 22, user: "j", auth: "agent", keyFile: "" }],
        remoteHost: "10.0.0.5",
        remotePort: 5432,
      },
      proxy: { type: "socks5", host: "proxy.local", port: 1080, username: "p" },
    });
    expect(descriptor.tags).toEqual(["kunde-a", "prod"]);
    expect(descriptor.vault).toBe(true);
    expect(descriptor.ssh).toEqual({
      host: "bastion.example.com",
      port: 2222,
      user: "deploy",
      auth: "key",
      keyFile: "~/.ssh/id_ed25519",
      agentSocket: null,
      jumpHosts: [
        { host: "jump", port: 22, user: "j", auth: "agent", keyFile: "", agentSocket: null },
      ],
      remoteHost: "10.0.0.5",
      remotePort: 5432,
    });
    expect(descriptor.proxy).toEqual({
      type: "socks5",
      host: "proxy.local",
      port: 1080,
      username: "p",
    });
  });

  test("Key-Value-Strings verlieren ihr Passwort", () => {
    const descriptor = buildAutomationConnection({
      ...base,
      id: "kv",
      kind: "mysql",
      connectionString: "Server=db;User=sa;Password=geheim;Database=app",
    });
    expect(descriptor.connectionString).not.toContain("geheim");
    expect(descriptor.connectionString).toContain("Server=db");
  });
});

describe("initAutomationSync", () => {
  test("Änderung am Store löst genau einen entprellten Sync aus", async () => {
    useConnectionsStore.setState({ connections: [base] });
    initAutomationSync();
    await wait(20);
    expect(syncCalls.length).toBe(1);
    expect((syncCalls[0] as { id: string }[]).map((entry) => entry.id)).toEqual(["pg"]);

    useConnectionsStore.setState({ connections: [{ ...base, name: "Prod A" }] });
    useConnectionsStore.setState({ connections: [{ ...base, name: "Prod B" }] });
    useConnectionsStore.setState({ connections: [{ ...base, name: "Prod C" }] });
    await wait(AUTOMATION_SYNC_DEBOUNCE_MS / 2);
    expect(syncCalls.length).toBe(1);
    await wait(AUTOMATION_SYNC_DEBOUNCE_MS + 100);
    expect(syncCalls.length).toBe(2);
    expect((syncCalls[1] as { name: string }[])[0].name).toBe("Prod C");
  });

  test("SSH-Vertrauen wird in die Einstellungen gespiegelt", async () => {
    const before = saved.length;
    useSettingsStore.setState({ sshTrustNewHosts: true });
    await wait(AUTOMATION_SYNC_DEBOUNCE_MS + 100);
    expect(saved.length).toBe(before + 1);
    expect((saved.at(-1) as { sshTrustNewHosts: boolean }).sshTrustNewHosts).toBe(true);
  });
});

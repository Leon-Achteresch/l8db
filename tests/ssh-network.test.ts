import { beforeEach, describe, expect, mock, test } from "bun:test";

const invocations: { command: string; args: Record<string, unknown> }[] = [];
const keychain = new Map<string, string>();
let proxyFailure: string | null = null;
let sequence = 7000;

const PROVIDERS = [
  {
    id: "postgres",
    name: "postgres",
    group: "postgres",
    kind: "postgres",
    default_port: 5432,
    file_based: false,
    url_schemes: ["postgresql", "postgres"],
    placeholder: "",
    hint: "",
    hosts: ["localhost"],
    driver: { type: "builtin" },
    capabilities: { ssl: true, ssh: true, views: true, read_only_mode: true, proxy_user: true },
    driver_status: { available: true, detail: "", install: [] },
  },
  {
    id: "mysql",
    name: "mysql",
    group: "mysql",
    kind: "mysql",
    default_port: 3306,
    file_based: false,
    url_schemes: ["mysql", "mariadb"],
    placeholder: "",
    hint: "",
    hosts: ["localhost"],
    driver: { type: "builtin" },
    capabilities: { ssl: true, ssh: true, views: true, read_only_mode: false, proxy_user: false },
    driver_status: { available: true, detail: "", install: [] },
  },
];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    invocations.push({ command, args });
    if (command === "list_providers") return PROVIDERS;
    if (command === "open_ssh_tunnel") return { local_port: ++sequence };
    if (command === "open_proxy_tunnel") {
      if (proxyFailure) throw proxyFailure;
      return { local_port: ++sequence };
    }
    if (command === "list_ssh_tunnels") return [];
    if (command === "store_secret") keychain.set(String(args.account), String(args.secret));
    if (command === "load_secret") return keychain.get(String(args.account)) ?? null;
    if (command === "delete_secret") keychain.delete(String(args.account));
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
const { useConnectionsStore, usesTunnel } = await import("../src/lib/connections");
const {
  activateConnection,
  buildSshTunnelRequest,
  effectiveConnectionString,
  onePasswordAgentSocket,
  proxyTarget,
  sshConfigDraft,
} = await import("../src/lib/ssh");
const { buildConnectionExport, parseConnectionImport, resolveImport } = await import(
  "../src/lib/connection-export"
);

const proxied = {
  id: "proxied",
  name: "Proxy",
  kind: "mysql" as const,
  connectionString: "mysql://app@db.internal/shop",
  sslMode: "disable" as const,
  proxy: { type: "socks5" as const, host: "proxy.local", port: 1080, username: "alice" },
};

const chained = {
  id: "chained",
  name: "Chain",
  kind: "postgres" as const,
  connectionString: "postgresql://app@db.internal:5432/app?sslmode=disable",
  sslMode: "disable" as const,
  ssh: {
    host: "db-gateway",
    port: 22,
    user: "deploy",
    auth: "agent" as const,
    keyFile: "",
    agentSocket: "~/.1password/agent.sock",
    jumpHosts: [
      { host: "bastion", port: 2200, user: "jump", auth: "password" as const, keyFile: "" },
      { host: "edge", port: 22, user: "edge", auth: "key" as const, keyFile: "/keys/edge" },
    ],
    remoteHost: "db.internal",
    remotePort: 5432,
  },
  proxy: { type: "http" as const, host: "corp-proxy", port: 3128 },
};

beforeEach(() => {
  invocations.length = 0;
  keychain.clear();
  proxyFailure = null;
  useConnectionsStore.setState({ connections: [proxied, chained], activeId: null });
});

describe("SSH-Netzwerkanfragen", () => {
  test("baut Agent-, Passwort- und Key-Hops samt Proxy in Reihenfolge", () => {
    const request = buildSshTunnelRequest(
      "chained",
      chained.ssh,
      chained.proxy,
      { ssh: null, jumps: ["jump-pw", "edge-passphrase"], proxy: null },
      false,
    );
    expect(request.auth).toEqual({ method: "agent", agent_socket: "~/.1password/agent.sock" });
    expect(request.jump_hosts.map((hop) => hop.host)).toEqual(["bastion", "edge"]);
    expect(request.jump_hosts[0].auth).toEqual({ method: "password", password: "jump-pw" });
    expect(request.jump_hosts[1].auth).toEqual({
      method: "key",
      key_file: "/keys/edge",
      passphrase: "edge-passphrase",
    });
    expect(request.proxy).toEqual({ kind: "http", host: "corp-proxy", port: 3128 });
    expect(request.accept_new_host_key).toBe(false);
  });

  test("meldet fehlende Sprung-Host-Passwörter statt still zu verbinden", () => {
    expect(() =>
      buildSshTunnelRequest(
        "chained",
        chained.ssh,
        null,
        { ssh: null, jumps: [], proxy: null },
        true,
      ),
    ).toThrow("Sprung-Host 1: SSH-Passwort fehlt");
  });

  test("ermittelt das Proxy-Ziel inklusive Standardport", () => {
    expect(proxyTarget("mysql://app@db.internal/shop", "mysql")).toEqual({
      host: "db.internal",
      port: 3306,
    });
    expect(proxyTarget("postgresql://app@[::1]:6543/app", "postgres")).toEqual({
      host: "::1",
      port: 6543,
    });
  });

  test("übernimmt Hosts aus ~/.ssh/config", () => {
    const draft = sshConfigDraft({
      alias: "prod",
      host_name: "10.0.0.5",
      user: "deploy",
      port: null,
      identity_file: "/keys/prod",
      identity_agent: null,
      proxy_jump: [
        {
          host: "bastion.example.com",
          port: 2200,
          user: null,
          identity_file: null,
          identity_agent: "/tmp/agent.sock",
        },
      ],
    });
    expect(draft).toMatchObject({ host: "10.0.0.5", port: 22, user: "deploy", auth: "key" });
    expect(draft.jumpHosts).toEqual([
      {
        host: "bastion.example.com",
        port: 2200,
        user: "deploy",
        auth: "agent",
        keyFile: "",
        agentSocket: "/tmp/agent.sock",
      },
    ]);
  });

  test("schlägt den 1Password-Socket plattformabhängig vor", () => {
    expect(onePasswordAgentSocket("MacIntel")).toContain("2BUA8C4S2C.com.1password/t/agent.sock");
    expect(onePasswordAgentSocket("Linux x86_64")).toBe("~/.1password/agent.sock");
    expect(onePasswordAgentSocket("Win32")).toBeNull();
  });
});

describe("Proxy ohne SSH", () => {
  test("öffnet den lokalen Weiterleitungsport vor dem Verbindungstest", async () => {
    keychain.set("proxied:proxy", "geheim");
    expect(usesTunnel(proxied)).toBe(true);
    expect(() => effectiveConnectionString(proxied)).toThrow("Proxy-Tunnel");
    expect((await activateConnection("proxied")).ok).toBe(true);
    const commands = invocations.map((entry) => entry.command);
    expect(commands.indexOf("open_proxy_tunnel")).toBeLessThan(
      commands.indexOf("test_connection_string"),
    );
    expect(
      invocations.find((entry) => entry.command === "open_proxy_tunnel")?.args.request,
    ).toEqual({
      id: "proxied",
      proxy: {
        kind: "socks5",
        host: "proxy.local",
        port: 1080,
        username: "alice",
        password: "geheim",
      },
      remote_host: "db.internal",
      remote_port: 3306,
    });
    const active = useConnectionsStore.getState().connections.find((c) => c.id === "proxied");
    expect(effectiveConnectionString(active ?? proxied)).toBe(
      `mysql://app@127.0.0.1:${active?.tunnelPort}/shop`,
    );
  });

  test("ein fehlschlagender Proxy verhindert die Aktivierung ohne Direktverbindung", async () => {
    proxyFailure = "SOCKS5-Proxy proxy.local:1080 ist nicht erreichbar";
    const outcome = await activateConnection("proxied");
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("nicht erreichbar");
    expect(invocations.map((entry) => entry.command)).not.toContain("test_connection_string");
    expect(useConnectionsStore.getState().activeId).toBeNull();
  });

  test("Entfernen löscht auch Sprung-Host- und Proxy-Geheimnisse", () => {
    keychain.set("chained:ssh-jumps", JSON.stringify(["a", "b"]));
    keychain.set("chained:proxy", "pw");
    useConnectionsStore.getState().removeConnection("chained");
    const deleted = invocations
      .filter((entry) => entry.command === "delete_secret")
      .map((entry) => entry.args.account);
    expect(deleted).toContain("chained:ssh-jumps");
    expect(deleted).toContain("chained:proxy");
  });
});

describe("Export und Import der Netzwerkeinstellungen", () => {
  test("Sprung-Hosts, Agent-Socket und Proxy überstehen den Rundlauf ohne Geheimnisse", () => {
    const file = buildConnectionExport([chained, proxied]);
    const text = JSON.stringify(file);
    expect(text).not.toContain("jump-pw");
    const parsed = parseConnectionImport(text, []);
    expect(parsed.error).toBeNull();
    const [first, second] = resolveImport(parsed.candidates, new Set([0, 1]), "skip");
    expect(first.ssh?.agentSocket).toBe("~/.1password/agent.sock");
    expect(first.ssh?.jumpHosts?.map((jump) => `${jump.user}@${jump.host}:${jump.port}`)).toEqual([
      "jump@bastion:2200",
      "edge@edge:22",
    ]);
    expect(first.ssh?.jumpHosts?.[1].keyFile).toBe("/keys/edge");
    expect(first.proxy).toEqual({ type: "http", host: "corp-proxy", port: 3128 });
    expect(second.proxy).toEqual(proxied.proxy);
  });
});

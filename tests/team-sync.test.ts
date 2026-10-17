import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SavedConnection } from "@/lib/connections";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

const calls: { command: string; args: unknown }[] = [];
let payload: unknown = { connections: [] };
let gate: Promise<void> | null = null;
let managed: unknown = null;
const keychain = new Map<string, string>();

mock.module("@tauri-apps/api/core", () => ({
  transformCallback: () => 1,
  invoke: async (command: string, args: unknown) => {
    calls.push({ command, args });
    if (command === "team_connections") {
      await gate;
      if (payload instanceof Error) throw payload;
      return payload;
    }
    if (command === "team_login")
      return {
        hub: (args as { hubUrl: string }).hubUrl.replace(/\/+$/, ""),
        user: { email: "max@firma.de", name: "Max" },
      };
    if (command === "team_share")
      return { entryId: "abc12345-shared", webUrl: "https://firma.sharepoint.com/x.json" };
    if (command === "store_secret") {
      const { account, secret } = args as { account: string; secret: string };
      keychain.set(account, secret);
      return null;
    }
    if (command === "load_secret")
      return keychain.get((args as { account: string }).account) ?? null;
    if (command === "delete_secret") {
      keychain.delete((args as { account: string }).account);
      return null;
    }
    if (command === "team_managed_hub") {
      if (managed instanceof Error) throw managed;
      return managed;
    }
    return null;
  },
}));

const { carryCredentials, mergeTeamConnections, teamConnectionId, withoutPassword } = await import(
  "@/lib/team/merge"
);
const { useConnectionsStore } = await import("@/lib/connections");
const { useTeamStore } = await import("@/lib/team/store");
const { MICROSOFT_HUB, initTeam, loginTeam, logoutTeam, needsConsent, syncTeam } = await import(
  "@/lib/team/sync"
);
const { needsPassword, needsUser } = await import("@/lib/password-prompt");
const { replaceUrlUser } = await import("@/lib/secrets");
const { collectLocal } = await import("@/lib/sync/local");
const { shareProblem, shareTeamConnection, teamEntry, withoutUser } = await import(
  "@/lib/team/share"
);

const HUB = "https://hub.firma.de";
const erp = {
  id: "erp",
  name: "ERP",
  kind: "postgres",
  connectionString: "postgres://erp.intern:5432/erp",
  environment: "production",
};

function local(overrides: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: "own",
    name: "Eigene",
    kind: "postgres",
    connectionString: "postgres://me@localhost/db",
    sslMode: "prefer",
    ...overrides,
  };
}

beforeEach(() => {
  calls.length = 0;
  gate = null;
  managed = null;
  payload = { connections: [] };
  useConnectionsStore.setState({ connections: [], activeId: null });
  useTeamStore.setState({
    hubUrl: "",
    user: null,
    name: null,
    lastSyncAt: null,
    lastError: null,
    managedHub: null,
    promptOpen: false,
    policyError: null,
    allowedHosts: [],
  });
});

describe("team connection merge", () => {
  test("adds hub connections with a stable id and keeps private ones", () => {
    const own = local();
    const { connections, added } = mergeTeamConnections([own], HUB, [erp]);
    expect(added).toBe(1);
    expect(connections[0]).toBe(own);
    expect(connections[1]).toMatchObject({
      id: teamConnectionId(HUB, "erp"),
      name: "ERP",
      sslMode: "prefer",
      team: { hub: HUB, id: "erp" },
    });
    expect(teamConnectionId(HUB, "erp")).toMatch(/^team-[0-9a-f]+-erp$/);
    expect(teamConnectionId("https://other.de", "erp")).not.toBe(teamConnectionId(HUB, "erp"));
  });

  test("keeps local edits and the database user unless the admin changes that field", () => {
    const first = mergeTeamConnections([], HUB, [erp]).connections[0];
    const edited = {
      ...first,
      name: "Mein ERP",
      color: "#ef4444",
      connectionString: "postgres://max:pw@erp.intern:5432/erp",
    };
    const unchanged = mergeTeamConnections([edited], HUB, [erp]);
    expect(unchanged.updated).toBe(0);
    expect(unchanged.connections[0]).toBe(edited);

    const relabeled = mergeTeamConnections([edited], HUB, [{ ...erp, environment: "staging" }]);
    expect(relabeled.retargeted).toEqual([]);
    expect(relabeled.connections[0].connectionString).toBe("postgres://max:pw@erp.intern:5432/erp");

    for (const change of [
      { connectionString: "postgres://erp.intern:5432/erp_neu" },
      { connectionString: "postgres://erp.intern:5432/erp?hostaddr=10.6.6.6" },
      { sslMode: "disable" },
    ]) {
      const changed = mergeTeamConnections([edited], HUB, [{ ...erp, ...change }]);
      expect(changed.retargeted).toEqual([first.id]);
      expect(changed.connections[0].connectionString).not.toContain(":pw@");
    }

    const moved = mergeTeamConnections([edited], HUB, [
      { ...erp, connectionString: "postgres://erp2.intern:5432/erp", color: "#22c55e" },
    ]);
    expect(moved.updated).toBe(1);
    expect(moved.retargeted).toEqual([first.id]);
    expect(moved.connections[0]).toMatchObject({
      name: "Mein ERP",
      color: "#22c55e",
      connectionString: "postgres://max@erp2.intern:5432/erp",
    });

    const tunneled = mergeTeamConnections([edited], HUB, [
      {
        ...erp,
        ssh: {
          host: "evil",
          port: 22,
          user: "",
          auth: "agent",
          keyFile: "",
          remoteHost: "erp.intern",
          remotePort: 5432,
        },
      },
    ]);
    expect(tunneled.retargeted).toEqual([first.id]);
    expect(tunneled.connections[0].connectionString).toBe("postgres://max@erp.intern:5432/erp");
  });

  test("local files, drivers and embedded passwords are refused with a hint", () => {
    const merge = mergeTeamConnections([], HUB, [
      { id: "a", name: "Datei", kind: "sqlite", connectionString: "sqlite:///etc/passwd" },
      { id: "b", name: "Treiber", kind: "odbc", connectionString: "Driver=/tmp/x.so" },
      { id: "c", name: "Geheim", kind: "postgres", connectionString: "postgres://h/db?password=x" },
      { id: "d", name: "Ok", kind: "postgres", connectionString: "postgres://h/db" },
    ]);
    expect(merge.connections.map((connection) => connection.name)).toEqual(["Ok"]);
    expect(merge.warnings).toHaveLength(3);
    const risky = mergeTeamConnections([], HUB, [
      {
        id: "n",
        name: "Ntlm",
        kind: "mssql",
        connectionString: "mssql://x:1433/db?integratedSecurity=true",
      },
      {
        id: "k",
        name: "Key",
        kind: "snowflake",
        connectionString: "snowflake://a/db?private_key_file=/k",
      },
      {
        id: "t",
        name: "Token",
        kind: "influxdb",
        connectionString: "influxdb://h:8086/b?token=abc",
      },
      { id: "w", name: "Win", kind: "mssql", connectionString: "Server=h;Trusted_Connection=yes" },
    ]);
    expect(risky.connections).toHaveLength(0);
    expect(risky.warnings).toHaveLength(4);
    const allowed = ["*.firma.intern", "db01"];
    const hosts = mergeTeamConnections(
      [],
      HUB,
      [
        {
          id: "a",
          name: "A",
          kind: "postgres",
          connectionString: "postgres://erp.firma.intern:5432/x",
        },
        { id: "b", name: "B", kind: "mssql", connectionString: "Server=tcp:DB01,1433;Database=x" },
        { id: "c", name: "C", kind: "postgres", connectionString: "postgres://evil.example/x" },
        {
          id: "d",
          name: "D",
          kind: "postgres",
          connectionString: "postgres://erp.firma.intern/x",
          ssh: {
            host: "evil",
            port: 22,
            user: "",
            auth: "agent",
            keyFile: "",
            remoteHost: "x",
            remotePort: 5432,
          },
        },
        {
          id: "e",
          name: "E",
          kind: "postgres",
          connectionString: "postgres://firma.intern.evil.example/x",
        },
      ],
      allowed,
    );
    expect(hosts.connections.map((connection) => connection.name)).toEqual(["A", "B"]);
    const ssh = (remoteHost: string, host = "bastion.firma.intern") => ({
      host,
      port: 22,
      user: "",
      auth: "agent",
      keyFile: "",
      remoteHost,
      remotePort: 5432,
    });
    const bypasses = mergeTeamConnections(
      [],
      HUB,
      [
        {
          id: "h1",
          name: "Hostaddr",
          kind: "postgres",
          connectionString: "postgres://db.firma.intern/x?hostaddr=203.0.113.5",
        },
        {
          id: "h2",
          name: "Multi",
          kind: "mongodb",
          connectionString: "mongodb://db.firma.intern,evil.com/x",
        },
        {
          id: "h3",
          name: "Remote",
          kind: "postgres",
          connectionString: "postgres://db.firma.intern/x",
          ssh: ssh("evil.com"),
        },
        {
          id: "h4",
          name: "V6",
          kind: "postgres",
          connectionString: "postgres://[fd00::1:1]:5432/x",
        },
        {
          id: "h5",
          name: "Failover",
          kind: "mssql",
          connectionString: "Server=db01;Failover Partner=evil.com",
        },
        {
          id: "h6",
          name: "Endpoint",
          kind: "snowflake",
          connectionString: "snowflake://acc.firma.intern/db?endpoint=evil.com",
        },
        {
          id: "h7",
          name: "Nodes",
          kind: "cassandra",
          connectionString: "cassandra://db.firma.intern/?nodes=evil.com:9042",
        },
        {
          id: "h8",
          name: "Backslash",
          kind: "clickhouse",
          connectionString: "https://evil.example\\@ch.firma.intern:8443/",
        },
        {
          id: "h9",
          name: "Tab",
          kind: "postgres",
          connectionString: "postgres://ev\til.com@db.firma.intern/x",
        },
        {
          id: "h10",
          name: "Socket",
          kind: "mysql",
          connectionString: "mysql://db.firma.intern/x?socket=/tmp/s",
        },
        {
          id: "ok1",
          name: "QueryHost",
          kind: "postgres",
          connectionString: "postgres://db.firma.intern/x?host=db01",
        },
        {
          id: "ok2",
          name: "Tunnel",
          kind: "postgres",
          connectionString: "postgres://db.firma.intern/x",
          ssh: ssh("db01"),
        },
      ],
      ["*.firma.intern", "db01", "fd00::1"],
    );
    expect(bypasses.connections.map((connection) => connection.name)).toEqual([
      "QueryHost",
      "Tunnel",
    ]);
    const aliases = mergeTeamConnections([], HUB, [
      { id: "a1", name: "MySQL", kind: "mysql", connectionString: "mysql://h/x?ssl-cert=/c.pem" },
      { id: "a2", name: "Mongo", kind: "mongodb", connectionString: "mongodb://h/x?tlsCAFile=/ca" },
      {
        id: "a3",
        name: "Snow",
        kind: "snowflake",
        connectionString: "snowflake://a/x?auth=externalbrowser",
      },
      {
        id: "a4",
        name: "Encoded",
        kind: "mssql",
        connectionString: "mssql://h/x?integrated%5FSecurity=true",
      },
    ]);
    expect(aliases.connections).toHaveLength(0);
    const cluster = mergeTeamConnections(
      [],
      HUB,
      [
        {
          id: "rs",
          name: "Replica",
          kind: "mongodb",
          connectionString: "mongodb://m1.firma.intern:27017,m2.firma.intern:27017/app",
        },
        {
          id: "cs",
          name: "Cassandra",
          kind: "cassandra",
          connectionString:
            "cassandra://c1.firma.intern/?nodes=c2.firma.intern:9042,c3.firma.intern:9042",
        },
        {
          id: "bad",
          name: "Mixed",
          kind: "mongodb",
          connectionString: "mongodb://m1.firma.intern:27017,evil.com:27017/app",
        },
      ],
      ["*.firma.intern"],
    );
    expect(cluster.connections.map((connection) => connection.name)).toEqual([
      "Replica",
      "Cassandra",
    ]);
    expect(hosts.warnings.join(" ")).toContain("evil.example");
    expect(merge.warnings[0]).toContain("sqlite");
    expect(withoutPassword("postgres://u:p@h/db")).toBe("postgres://u@h/db");
    expect(withoutPassword("Server=h;Password=x;User Id=u")).toBe("Server=h;User Id=u");
  });

  test("removes connections the hub no longer lists and ignores other hubs", () => {
    const team = mergeTeamConnections([], HUB, [erp]).connections[0];
    const foreign = { ...team, id: "x", team: { hub: "https://other.de", id: "erp", base: {} } };
    const merge = mergeTeamConnections([team, foreign], HUB, []);
    expect(merge.removed).toEqual([team.id]);
    expect(merge.connections).toEqual([foreign]);
  });

  test("never takes fields outside the whitelist and skips malformed entries", () => {
    const merge = mergeTeamConnections([], HUB, [
      { ...erp, commandTunnel: { command: "calc.exe" }, cloudAuth: { mode: "x" }, vault: true },
      { id: "bad id", name: "x", kind: "postgres", connectionString: "x://h" },
      { id: "nostring", name: "x", kind: "postgres" },
      null,
    ]);
    expect(merge.connections).toHaveLength(1);
    expect(merge.connections[0]).not.toHaveProperty("commandTunnel");
    expect(merge.connections[0]).not.toHaveProperty("cloudAuth");
    expect(merge.connections[0]).not.toHaveProperty("vault");
  });

  test("credential carry-over only fills an empty user part", () => {
    expect(carryCredentials("postgres://new/db", "postgres://u:p@old/db")).toBe(
      "postgres://u:p@new/db",
    );
    expect(carryCredentials("postgres://admin@new/db", "postgres://u@old/db")).toBe(
      "postgres://admin@new/db",
    );
    expect(carryCredentials("postgres://new/db", "postgres://old/db")).toBe("postgres://new/db");
    expect(carryCredentials("Server=new", "postgres://u@old/db")).toBe("Server=new");
    expect(replaceUrlUser("postgres://h:5432/db", "max müller")).toBe(
      "postgres://max%20m%C3%BCller@h:5432/db",
    );
    expect(replaceUrlUser("postgres://mxa:pw@h/db", "max")).toBe("postgres://max@h/db");
  });
});

test("malformed nested fields from the hub are dropped", () => {
  const [connection] = mergeTeamConnections([], HUB, [
    {
      ...erp,
      sslMode: "nope",
      ssh: "bastion",
      proxy: { type: "socks5", host: "p", port: "1080" },
      tags: ["prod"],
      environment: "live",
      readOnly: "yes",
      schemas: [1],
    },
  ]).connections;
  for (const field of ["ssh", "proxy", "tags", "environment", "readOnly", "schemas"])
    expect(connection).not.toHaveProperty(field);
  expect(connection.sslMode).toBe("prefer");
  const ssh = {
    host: "b",
    port: 22,
    user: "",
    auth: "agent",
    keyFile: "",
    remoteHost: "db",
    remotePort: 5432,
  };
  expect(mergeTeamConnections([], HUB, [{ ...erp, ssh }]).connections[0].ssh).toEqual(ssh);
  const remoteKey = mergeTeamConnections([], HUB, [
    {
      ...erp,
      ssh: { ...ssh, auth: "key", keyFile: "/home/admin/.ssh/id", agentSocket: "/tmp/agent" },
    },
  ]).connections[0].ssh;
  expect(remoteKey).toMatchObject({ keyFile: "", auth: "key" });
  expect(remoteKey).not.toHaveProperty("agentSocket");
  const added = mergeTeamConnections([], HUB, [{ ...erp, ssh }]).connections[0];
  const mine = {
    ...added,
    ssh: { ...ssh, keyFile: "/home/max/.ssh/id", agentSocket: "/run/agent" },
  };
  const legacy = {
    ...mine,
    team: { hub: HUB, id: "erp", base: { ...erp, ssh: { ...ssh, keyFile: "/admin" } } },
  };
  const upgraded = mergeTeamConnections([legacy], HUB, [{ ...erp, ssh, color: "#3b82f6" }]);
  expect(upgraded.retargeted).toEqual([]);
  expect(upgraded.connections[0].ssh).toMatchObject({
    keyFile: "/home/max/.ssh/id",
    agentSocket: "/run/agent",
  });
  const moved = mergeTeamConnections([mine], HUB, [{ ...erp, ssh: { ...ssh, port: 2222 } }]);
  expect(moved.retargeted).toEqual([added.id]);
  expect(moved.connections[0].ssh).toMatchObject({ port: 2222, keyFile: "/home/max/.ssh/id" });
});

describe("managed hub file", () => {
  test("without a file startup only checks for it", async () => {
    await initTeam();
    expect(calls.map((call) => call.command)).toEqual(["team_managed_hub"]);
    expect(useTeamStore.getState().promptOpen).toBe(false);
  });

  test("an unreadable file behaves like no file", async () => {
    managed = new Error("/etc/l8db/hub.json: kaputt");
    await initTeam();
    expect(useTeamStore.getState()).toMatchObject({ managedHub: null, promptOpen: false });
  });

  test("a file opens the login prompt without contacting the hub", async () => {
    managed = { url: HUB };
    await initTeam();
    expect(calls.map((call) => call.command)).toEqual(["team_managed_hub"]);
    expect(useTeamStore.getState()).toMatchObject({
      managedHub: HUB,
      hubUrl: HUB,
      promptOpen: true,
    });
    payload = { connections: [erp] };
    await loginTeam(useTeamStore.getState().managedHub ?? "");
    expect(useConnectionsStore.getState().connections).toHaveLength(1);
  });

  test("a signed-in user is synced once instead of prompted", async () => {
    managed = { url: HUB };
    useTeamStore.setState({ hubUrl: HUB, user: { email: "max@firma.de", name: "Max" } });
    payload = { connections: [erp] };
    await initTeam();
    expect(calls.map((call) => call.command)).toEqual(["team_managed_hub", "team_connections"]);
    expect(useTeamStore.getState().promptOpen).toBe(false);
  });

  test("an expired hub token prompts again instead of failing silently", async () => {
    managed = { url: HUB };
    useTeamStore.setState({ hubUrl: HUB, user: { email: "max@firma.de", name: "Max" } });
    payload = new Error("Team-Anmeldung abgelaufen. Bitte erneut anmelden.");
    await initTeam();
    expect(useTeamStore.getState().promptOpen).toBe(true);
  });

  test("the policy host allowlist reaches the sync", async () => {
    managed = { url: HUB, source: "HKLM", allowedHosts: ["*.firma.intern"] };
    useTeamStore.setState({ hubUrl: HUB, user: { email: "max@firma.de", name: "Max" } });
    payload = { connections: [erp] };
    await initTeam();
    expect(useConnectionsStore.getState().connections).toHaveLength(0);
    expect(useTeamStore.getState().warnings.join(" ")).toContain("erp.intern");
  });

  test("a broken policy blocks team sync and login instead of failing open", async () => {
    useTeamStore.setState({ hubUrl: HUB, user: { email: "max@firma.de", name: "Max" } });
    managed = new Error("HKLM: allowedHosts enthält ungültigen Eintrag");
    await initTeam();
    expect(calls.map((call) => call.command)).toEqual(["team_managed_hub"]);
    expect(useTeamStore.getState().policyError).toContain("allowedHosts");
    await expect(syncTeam()).rejects.toThrow("Richtlinie");
    await expect(loginTeam(HUB)).rejects.toThrow("Richtlinie");
    managed = { url: "", source: "HKLM", allowedHosts: ["*.firma.intern"] };
    payload = {
      connections: [erp, { ...erp, id: "ok", connectionString: "postgres://a.firma.intern/x" }],
    };
    await initTeam();
    expect(useTeamStore.getState()).toMatchObject({
      policyError: null,
      managedHub: null,
      promptOpen: false,
    });
    expect(
      useConnectionsStore.getState().connections.map((connection) => connection.team?.id),
    ).toEqual(["ok"]);
  });

  test("secondary windows only learn the managed hub", async () => {
    managed = { url: HUB };
    useTeamStore.setState({ hubUrl: HUB, user: { email: "max@firma.de", name: "Max" } });
    await initTeam(false);
    expect(calls.map((call) => call.command)).toEqual(["team_managed_hub"]);
    expect(useTeamStore.getState()).toMatchObject({ managedHub: HUB, promptOpen: false });
  });

  test("startup with a managed hub stays fast and makes at most one hub request", async () => {
    managed = { url: HUB };
    payload = {
      connections: Array.from({ length: 500 }, (_, index) => ({ ...erp, id: `db${index}` })),
    };
    useTeamStore.setState({ hubUrl: HUB, user: { email: "max@firma.de", name: "Max" } });
    await initTeam();
    calls.length = 0;
    const signedIn = await measureScenario(() => initTeam(), 15);
    const starts = 15 + 2;
    expect(calls.filter((call) => call.command === "team_managed_hub")).toHaveLength(starts);
    expect(calls.filter((call) => call.command === "team_connections")).toHaveLength(starts);
    reportScenario("team-startup-managed-signed-in", { connections: 500, ...signedIn });
    expect(signedIn.p95Ms).toBeLessThan(30);

    useTeamStore.setState({ user: null });
    calls.length = 0;
    const prompt = await measureScenario(() => initTeam(), 15);
    expect(calls.every((call) => call.command === "team_managed_hub")).toBe(true);
    reportScenario("team-startup-managed-prompt", prompt);
    expect(prompt.p95Ms).toBeLessThan(5);
  });

  test("a hub switched by the admin signs out of the old one and prompts", async () => {
    payload = { connections: [erp] };
    await loginTeam("https://alt.firma.de");
    managed = { url: HUB };
    calls.length = 0;
    await initTeam();
    expect(
      calls.map((call) => call.command).filter((command) => command.startsWith("team_")),
    ).toEqual(["team_managed_hub", "team_logout"]);
    expect(useConnectionsStore.getState().connections).toHaveLength(0);
    expect(useTeamStore.getState()).toMatchObject({ user: null, hubUrl: HUB, promptOpen: true });
  });
});

describe("team sync", () => {
  test("login stores the user, pulls connections and the prompt asks for the database user", async () => {
    payload = { name: "Firma", connections: [erp] };
    useConnectionsStore.setState({ connections: [local()] });
    const merge = await loginTeam(`${HUB}/`);
    expect(calls.map((call) => call.command)).toEqual(["team_login", "team_connections"]);
    expect(calls[0].args).toEqual({ hubUrl: `${HUB}/`, admin: false });
    expect(merge?.added).toBe(1);
    expect(useTeamStore.getState()).toMatchObject({ hubUrl: HUB, name: "Firma", lastError: null });
    const team = useConnectionsStore.getState().connections.find((entry) => entry.team);
    expect(team && needsUser(team)).toBe(true);
    expect(team && needsPassword(team)).toBe(true);
    expect(needsUser(local())).toBe(false);
  });

  test("team connections stay out of personal sync and survive editing", async () => {
    payload = { connections: [erp] };
    useConnectionsStore.setState({ connections: [local()] });
    await loginTeam(HUB);
    const ids = collectLocal(false).connections.map((entry) => entry.id);
    expect(ids).toEqual(["own"]);
    const team = useConnectionsStore.getState().connections.find((entry) => entry.team);
    if (!team) throw new Error("missing");
    const { id: _id, team: _team, ...input } = team;
    useConnectionsStore.getState().updateConnection(team.id, { ...input, name: "Umbenannt" });
    expect(
      useConnectionsStore.getState().connections.find((entry) => entry.id === team.id)?.team,
    ).toEqual(team.team);
    const copy = useConnectionsStore.getState().duplicateConnection(team.id);
    expect(copy?.team).toBeNull();
  });

  test("logout removes team connections but keeps private ones", async () => {
    payload = { connections: [erp] };
    useConnectionsStore.setState({ connections: [local()] });
    await loginTeam(HUB);
    await logoutTeam();
    expect(useConnectionsStore.getState().connections.map((entry) => entry.id)).toEqual(["own"]);
    expect(useTeamStore.getState().user).toBeNull();
    expect(calls.some((call) => call.command === "team_logout")).toBe(true);
  });

  test("only database kinds with users ask for one", async () => {
    payload = {
      connections: [
        erp,
        { id: "file", name: "F", kind: "mongodb", connectionString: "mongodb://mongo:27017/app" },
        { id: "cache", name: "C", kind: "redis", connectionString: "redis://cache:6379" },
      ],
    };
    await loginTeam(HUB);
    const asks = useConnectionsStore
      .getState()
      .connections.map((entry) => [entry.team?.id, needsUser(entry)]);
    expect(asks).toEqual([
      ["erp", true],
      ["file", false],
      ["cache", false],
    ]);
  });

  test("an incomplete listing never removes connections", async () => {
    payload = { connections: [erp, { ...erp, id: "zwei", name: "Zwei" }] };
    await loginTeam(HUB);
    payload = { connections: [erp], complete: false, warnings: ["riesig.json: größer als 256 KB"] };
    const merge = await syncTeam();
    expect(merge?.removed).toEqual([]);
    expect(useConnectionsStore.getState().connections).toHaveLength(2);
    expect(useTeamStore.getState().warnings).toContain("riesig.json: größer als 256 KB");
  });

  test("a retargeted connection loses its stored secrets", async () => {
    payload = { connections: [erp] };
    await loginTeam(HUB);
    payload = { connections: [{ ...erp, connectionString: "postgres://neu.intern/erp" }] };
    calls.length = 0;
    await syncTeam();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const id = teamConnectionId(HUB, "erp");
    expect(
      calls
        .filter((call) => call.command === "delete_secret")
        .map((call) => (call.args as { account: string }).account),
    ).toContain(id);
    expect(useTeamStore.getState().warnings.join(" ")).toContain("anderes Ziel");
  });

  test("an expired session removes team connections after the offboarding period", async () => {
    payload = { connections: [erp] };
    await loginTeam(HUB);
    payload = new Error("Team-Anmeldung abgelaufen. Bitte erneut anmelden.");
    await expect(syncTeam()).rejects.toThrow();
    expect(useConnectionsStore.getState().connections).toHaveLength(1);
    useTeamStore.setState({ expiredSince: Date.now() - 1000 });
    payload = { connections: [erp] };
    await loginTeam(HUB);
    expect(useTeamStore.getState().expiredSince).toBeNull();
    payload = new Error("Team-Anmeldung abgelaufen. Bitte erneut anmelden.");
    await expect(syncTeam()).rejects.toThrow();
    useTeamStore.setState({ expiredSince: Date.now() - 15 * 86_400_000 });
    await expect(syncTeam()).rejects.toThrow();
    expect(useConnectionsStore.getState().connections).toHaveLength(0);
    expect(useTeamStore.getState().user).toBeNull();
  });

  test("an invalid hub answer keeps every team connection", async () => {
    payload = { connections: [erp] };
    await loginTeam(HUB);
    payload = {};
    await expect(syncTeam()).rejects.toThrow("Ungültige Antwort");
    expect(useConnectionsStore.getState().connections).toHaveLength(1);
    expect(useTeamStore.getState().lastError).toBe("Ungültige Antwort vom Team-Hub.");
  });

  test("a sync still in flight during logout does not bring connections back", async () => {
    payload = { connections: [erp] };
    await loginTeam(HUB);
    let open = () => {};
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const pending = syncTeam();
    await logoutTeam();
    open();
    expect(await pending).toBeNull();
    expect(useConnectionsStore.getState().connections).toHaveLength(0);
    expect(useTeamStore.getState().user).toBeNull();
  });

  test("microsoft login keeps sharepoint warnings and recognises missing consent", async () => {
    payload = { name: "l8db", connections: [erp], warnings: ["kaputt.json: kein gültiges JSON"] };
    await loginTeam(MICROSOFT_HUB, true);
    expect(calls[0]).toEqual({ command: "team_login", args: { hubUrl: "m365", admin: true } });
    expect(useTeamStore.getState()).toMatchObject({
      hubUrl: "m365",
      name: "l8db",
      warnings: ["kaputt.json: kein gültiges JSON"],
    });
    expect(useConnectionsStore.getState().connections[0].team?.hub).toBe("m365");
    expect(
      needsConsent(new Error("Deine IT muss l8db einmal für eure Organisation freigeben. x")),
    ).toBe(true);
    expect(needsConsent(new Error("anderer Fehler"))).toBe(false);
  });

  test("nothing is fetched while logged out", async () => {
    expect(await syncTeam()).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

test("team sync of 2,000 hub connections next to 2,000 private ones stays within budget", async () => {
  const privateConnections = Array.from({ length: 2000 }, (_, index) =>
    local({ id: `own-${index}`, name: `Eigene ${index}` }),
  );
  const entries = Array.from({ length: 2000 }, (_, index) => ({
    ...erp,
    id: `db${index}`,
    name: `Team ${index}`,
    connectionString: `postgres://db${index}.intern:5432/app`,
    ssh: {
      host: "bastion",
      port: 22,
      user: "",
      auth: "agent",
      keyFile: "",
      remoteHost: "db",
      remotePort: 5432,
    },
  }));
  const initial = mergeTeamConnections(privateConnections, HUB, entries).connections;
  let result = mergeTeamConnections(initial, HUB, entries);
  const steady = await measureScenario(() => {
    result = mergeTeamConnections(initial, HUB, entries);
  }, 15);
  expect(result.updated).toBe(0);
  expect(result.connections.every((connection, index) => connection === initial[index])).toBe(true);
  reportScenario("team-sync-merge-steady", { local: 2000, team: 2000, ...steady });
  expect(steady.p95Ms).toBeLessThan(40);

  const changed = entries.map((entry) => ({
    ...entry,
    connectionString: `${entry.connectionString}?x=1`,
  }));
  const updating = await measureScenario(() => {
    result = mergeTeamConnections(initial, HUB, changed);
  }, 15);
  expect(result.updated).toBe(2000);
  reportScenario("team-sync-merge-update", { local: 2000, team: 2000, ...updating });
  expect(updating.p95Ms).toBeLessThan(60);

  useTeamStore.setState({ hubUrl: HUB, user: { email: "max@firma.de", name: "Max" } });
  payload = { connections: entries };
  calls.length = 0;
  let open = () => {};
  gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const concurrent = [syncTeam(), syncTeam(), syncTeam()];
  open();
  await Promise.all(concurrent);
  expect(calls.filter((call) => call.command === "team_connections")).toHaveLength(1);
  gate = null;
  calls.length = 0;
  await syncTeam();
  expect(calls).toHaveLength(1);
});

describe("sharing with the team", () => {
  const own = (overrides: Partial<SavedConnection> = {}): SavedConnection => ({
    id: "own-erp",
    name: "ERP Produktion",
    kind: "postgres",
    connectionString: "postgres://max:geheim@erp.firma.intern:5432/erp?sslmode=require&token=t",
    sslMode: "require",
    environment: "production",
    ssh: {
      host: "bastion.firma.intern",
      port: 22,
      user: "tunnel",
      auth: "key",
      keyFile: "/home/max/.ssh/id",
      agentSocket: "/run/agent",
      remoteHost: "erp.firma.intern",
      remotePort: 5432,
    },
    ...overrides,
  });

  test("the shared file carries no personal credentials or local paths", () => {
    const entry = teamEntry(own(), "x1");
    expect(entry).toMatchObject({
      id: "erp-produktion-x1",
      name: "ERP Produktion",
      kind: "postgres",
      environment: "production",
      sslMode: "require",
    });
    expect(entry.connectionString).toBe("postgres://erp.firma.intern:5432/erp?sslmode=require");
    expect(entry.ssh).toMatchObject({ user: "tunnel", keyFile: "" });
    expect(entry.ssh).not.toHaveProperty("agentSocket");
    expect(withoutUser("Server=h;User Id=max;Password=x;Database=d")).toBe("Server=h;Database=d");
    expect(withoutUser("clickhouse://h:8123/db?user=max&secure=1&Username=m")).toBe(
      "clickhouse://h:8123/db?secure=1",
    );
    expect(teamEntry(own({ name: "Müller Größe" }), "x").id).toBe("mueller-groesse-x");
  });

  test("connections that cannot work for the team are explained before uploading", () => {
    useConnectionsStore.setState({ connections: [], activeId: "own-erp" });
    expect(shareProblem(own())).toBeNull();
    expect(shareProblem(own({ team: { hub: MICROSOFT_HUB, id: "x", base: {} } }))).toContain(
      "bereits",
    );
    expect(shareProblem(own({ kind: "sqlite", connectionString: "sqlite:///tmp/x.db" }))).toContain(
      "nicht erlaubt",
    );
    expect(shareProblem(own({ temporary: true }))).toContain("speichern");
    useTeamStore.setState({ allowedHosts: ["*.example.com"] });
    expect(shareProblem(own())).toContain("nicht freigegeben");
    useTeamStore.setState({ allowedHosts: [] });
  });

  test("sharing links the existing connection to the team copy without moving anything", async () => {
    keychain.clear();
    keychain.set("own-erp", "geheim");
    useConnectionsStore.setState({
      connections: [own()],
      activeId: "own-erp",
      recentIds: ["own-erp"],
    });
    useTeamStore.setState({ hubUrl: MICROSOFT_HUB, user: { email: "max@firma.de", name: "Max" } });
    calls.length = 0;
    const shared = await shareTeamConnection("own-erp", "folder-1");
    expect(shared.id).toBe("own-erp");
    expect(shared.team?.id).toBe("abc12345-shared");
    expect(useConnectionsStore.getState()).toMatchObject({
      activeId: "own-erp",
      recentIds: ["own-erp"],
    });
    expect(calls.some((call) => /secret/.test(call.command))).toBe(false);
    expect(keychain.get("own-erp")).toBe("geheim");
    const upload = calls.find((call) => call.command === "team_share")?.args as {
      folder: string;
      content: Record<string, unknown>;
    };
    expect(upload.folder).toBe("folder-1");
    payload = { connections: [{ ...upload.content, id: "abc12345-shared" }] };
    const merge = await syncTeam();
    expect(merge).toMatchObject({ retargeted: [], removed: [], added: 0, updated: 0 });
    const [kept] = useConnectionsStore.getState().connections;
    expect(useConnectionsStore.getState().connections).toHaveLength(1);
    expect(kept.connectionString).toContain("max:geheim@");
    expect(kept.ssh?.keyFile).toBe("/home/max/.ssh/id");
    payload = { connections: [] };
    expect((await syncTeam())?.removed).toEqual(["own-erp"]);
  });

  test("checking 2,000 connections for sharing stays fast", async () => {
    useConnectionsStore.setState({ activeId: null });
    const many = Array.from({ length: 2000 }, (_, index) =>
      own({ id: `c${index}`, name: `DB ${index}` }),
    );
    let problems = 0;
    const timing = await measureScenario(() => {
      problems = many.filter((connection) => shareProblem(connection) !== null).length;
    }, 9);
    reportScenario("team-share-check", { connections: 2000, ...timing });
    expect(problems).toBe(0);
    expect(timing.p95Ms).toBeLessThan(100);
  });
});

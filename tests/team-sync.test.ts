import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SavedConnection } from "@/lib/connections";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

const calls: { command: string; args: unknown }[] = [];
let payload: unknown = { path: "/home/max/.l8db/connections.json", exists: true, connections: [] };
let gate: Promise<void> | null = null;

mock.module("@tauri-apps/api/core", () => ({
  transformCallback: () => 1,
  invoke: async (command: string, args: unknown) => {
    calls.push({ command, args });
    if (command === "team_connections") {
      await gate;
      if (payload instanceof Error) throw payload;
      return payload;
    }
    return null;
  },
}));

const { carryCredentials, mergeTeamConnections, teamConnectionId, withoutPassword } = await import(
  "@/lib/team/merge"
);
const { useConnectionsStore } = await import("@/lib/connections");
const { useTeamStore } = await import("@/lib/team/store");
const { TEAM_HUB, initTeam, syncTeam } = await import("@/lib/team/sync");
const { needsPassword, needsUser } = await import("@/lib/password-prompt");
const { replaceUrlUser } = await import("@/lib/secrets");
const { collectLocal } = await import("@/lib/sync/local");

const PATH = "/home/max/.l8db/connections.json";
const file = (connections: unknown[], exists = true) => ({ path: PATH, exists, connections });

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
  payload = file([]);
  useConnectionsStore.setState({ connections: [], activeId: null });
  useTeamStore.setState({
    path: null,
    exists: false,
    lastSyncAt: null,
    lastError: null,
    warnings: [],
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
    const unsafe = mergeTeamConnections([], HUB, [
      {
        id: "h8",
        name: "Backslash",
        kind: "clickhouse",
        connectionString: "https://evil.example\\@ch.firma.intern:8443/",
      },
      { id: "h9", name: "Tab", kind: "postgres", connectionString: "postgres://ev\til.com@db/x" },
      { id: "h10", name: "Socket", kind: "mysql", connectionString: "mysql://db/x?socket=/tmp/s" },
    ]);
    expect(unsafe.connections).toHaveLength(0);
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

describe("team file sync", () => {
  test("startup reads the file once and the prompt asks for the database user", async () => {
    payload = file([erp]);
    useConnectionsStore.setState({ connections: [local()] });
    await initTeam();
    expect(calls.map((call) => call.command)).toEqual(["team_connections"]);
    expect(useTeamStore.getState()).toMatchObject({ path: PATH, exists: true, lastError: null });
    const team = useConnectionsStore.getState().connections.find((entry) => entry.team);
    expect(team?.team?.hub).toBe(TEAM_HUB);
    expect(team && needsUser(team)).toBe(true);
    expect(team && needsPassword(team)).toBe(true);
    expect(needsUser(local())).toBe(false);
  });

  test("focus within a minute of the last read stays idle", async () => {
    if (typeof window.addEventListener !== "function") {
      const target = new EventTarget();
      Object.assign(window, {
        addEventListener: target.addEventListener.bind(target),
        dispatchEvent: target.dispatchEvent.bind(target),
      });
    }
    await initTeam();
    calls.length = 0;
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toHaveLength(0);
    useTeamStore.setState({ lastSyncAt: Date.now() - 61_000 });
    window.dispatchEvent(new Event("focus"));
    for (let i = 0; i < 100 && calls.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls.map((call) => call.command)).toEqual(["team_connections"]);
  });

  test("secondary windows never read the file", async () => {
    await initTeam(false);
    expect(calls).toHaveLength(0);
  });

  test("team connections stay out of personal sync and survive editing", async () => {
    payload = file([erp]);
    useConnectionsStore.setState({ connections: [local()] });
    await syncTeam();
    expect(collectLocal(false).connections.map((entry) => entry.id)).toEqual(["own"]);
    const team = useConnectionsStore.getState().connections.find((entry) => entry.team);
    if (!team) throw new Error("missing");
    const { id: _id, team: _team, ...input } = team;
    useConnectionsStore.getState().updateConnection(team.id, { ...input, name: "Umbenannt" });
    expect(
      useConnectionsStore.getState().connections.find((entry) => entry.id === team.id)?.team,
    ).toEqual(team.team);
    expect(useConnectionsStore.getState().duplicateConnection(team.id)?.team).toBeNull();
  });

  test("a deleted file removes team connections but keeps private ones", async () => {
    payload = file([erp]);
    useConnectionsStore.setState({ connections: [local()] });
    await syncTeam();
    payload = file([], false);
    calls.length = 0;
    const merge = await syncTeam();
    expect(calls.filter((call) => call.command === "team_connections")).toHaveLength(2);
    expect(merge.removed).toHaveLength(1);
    expect(useConnectionsStore.getState().connections.map((entry) => entry.id)).toEqual(["own"]);
    expect(useTeamStore.getState().exists).toBe(false);
  });

  test("connections from the old hub or Microsoft 365 are removed", async () => {
    const old = (hub: string, id: string) => local({ id, name: id, team: { hub, id, base: {} } });
    useConnectionsStore.setState({
      connections: [local(), old("m365", "sp"), old("https://hub.firma.de", "hub")],
    });
    payload = file([erp]);
    const merge = await syncTeam();
    expect(merge.removed.sort()).toEqual(["hub", "sp"]);
    expect(useTeamStore.getState().warnings[0]).toContain(
      "2 Verbindungen aus dem früheren Team-Hub",
    );
    expect(useConnectionsStore.getState().connections.map((entry) => entry.id)).toEqual([
      "own",
      teamConnectionId(TEAM_HUB, "erp"),
    ]);
  });

  test("an unreadable file keeps every team connection and shows the error", async () => {
    payload = file([erp]);
    await syncTeam();
    payload = new Error(`${PATH}: kein gültiges JSON`);
    await expect(syncTeam()).rejects.toThrow("JSON");
    expect(useConnectionsStore.getState().connections).toHaveLength(1);
    expect(useTeamStore.getState().lastError).toContain("kein gültiges JSON");
  });

  test("a retargeted connection loses its stored secrets", async () => {
    payload = file([erp]);
    await syncTeam();
    payload = file([{ ...erp, connectionString: "postgres://neu.intern/erp" }]);
    calls.length = 0;
    await syncTeam();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      calls
        .filter((call) => call.command === "delete_secret")
        .map((call) => (call.args as { account: string }).account),
    ).toContain(teamConnectionId(TEAM_HUB, "erp"));
    expect(useTeamStore.getState().warnings.join(" ")).toContain("anderes Ziel");
  });
});

test("team sync of 2,000 file connections next to 2,000 private ones stays within budget", async () => {
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

  payload = file(entries);
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

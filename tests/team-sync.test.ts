import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SavedConnection } from "@/lib/connections";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

const calls: { command: string; args: unknown }[] = [];
let payload: unknown = { connections: [] };
let gate: Promise<void> | null = null;

mock.module("@tauri-apps/api/core", () => ({
  transformCallback: () => 1,
  invoke: async (command: string, args: unknown) => {
    calls.push({ command, args });
    if (command === "team_connections") {
      await gate;
      return payload;
    }
    if (command === "team_login") return { email: "max@firma.de", name: "Max" };
    return null;
  },
}));

const { carryCredentials, mergeTeamConnections, teamConnectionId } = await import(
  "@/lib/team/merge"
);
const { useConnectionsStore } = await import("@/lib/connections");
const { useTeamStore } = await import("@/lib/team/store");
const { loginTeam, logoutTeam, syncTeam } = await import("@/lib/team/sync");
const { needsPassword, needsUser } = await import("@/lib/password-prompt");
const { replaceUrlUser } = await import("@/lib/secrets");
const { collectLocal } = await import("@/lib/sync/local");

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
  payload = { connections: [] };
  useConnectionsStore.setState({ connections: [], activeId: null });
  useTeamStore.setState({ hubUrl: "", user: null, name: null, lastSyncAt: null, lastError: null });
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

    const moved = mergeTeamConnections([edited], HUB, [
      { ...erp, connectionString: "postgres://erp2.intern:5432/erp", color: "#22c55e" },
    ]);
    expect(moved.updated).toBe(1);
    expect(moved.connections[0]).toMatchObject({
      name: "Mein ERP",
      color: "#22c55e",
      connectionString: "postgres://max:pw@erp2.intern:5432/erp",
    });
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
});

describe("team sync", () => {
  test("login stores the user, pulls connections and the prompt asks for the database user", async () => {
    payload = { name: "Firma", connections: [erp] };
    useConnectionsStore.setState({ connections: [local()] });
    const merge = await loginTeam(`${HUB}/`);
    expect(calls.map((call) => call.command)).toEqual(["team_login", "team_connections"]);
    expect(calls[0].args).toEqual({ hubUrl: HUB });
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
        { id: "file", name: "F", kind: "sqlite", connectionString: "sqlite:///data/app.db" },
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

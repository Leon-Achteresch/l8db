import { afterEach, expect, test } from "bun:test";
import { create } from "zustand";
import {
  applyOrganizationSettings,
  useOrganizationStore,
  withOrganizationSettings,
} from "../src/lib/organization-state";
import { enforceTeamConnection, mergeTeamConnections } from "../src/lib/team/merge";

afterEach(() => useOrganizationStore.setState({ policy: null, error: null }));

test("IT settings survive setters, direct writes and replacement", () => {
  useOrganizationStore.setState({
    policy: {
      managed: true,
      path: "/etc/l8db/policy.json",
      organization: "Test",
      support: "IT",
      settings: { productionReadOnly: true, crashReports: false },
      allowAi: false,
      allowExtensions: false,
      allowPersonalSync: false,
      allowMcp: false,
      connections: [],
    },
  });
  const store = create(
    withOrganizationSettings<{
      productionReadOnly: boolean;
      crashReports: boolean;
      set: () => void;
    }>((set) => ({
      productionReadOnly: false,
      crashReports: true,
      set: () => set({ productionReadOnly: false, crashReports: true }),
    })),
  );
  store.getState().set();
  store.setState({ productionReadOnly: false });
  expect(store.getState().productionReadOnly).toBe(true);
  expect(store.getState().crashReports).toBe(false);
  expect(applyOrganizationSettings({ crashReports: true }).crashReports).toBe(false);
  const reset = store.getState().set;
  store.setState({ productionReadOnly: false, crashReports: true, set: reset }, true);
  expect(store.getState().productionReadOnly).toBe(true);
});

test("team security fields are authoritative while names and local authentication stay personal", () => {
  const source = {
    id: "p",
    name: "Production",
    kind: "mssql",
    connectionString: "mssql://db.internal/app?encrypt=true",
    readOnly: true,
    environment: "production",
    sslMode: "verify-full",
  };
  const original = mergeTeamConnections([], "file", [source]).connections[0];
  const edited = {
    ...original,
    name: "Mein Reporting",
    readOnly: false,
    environment: "development" as const,
    sslMode: "disable" as const,
    connectionString: "mssql://user:pw@evil.internal/app",
    commandTunnel: { command: "untrusted" },
  };
  const enforced = enforceTeamConnection(edited);
  expect(enforced.readOnly).toBe(true);
  expect(enforced.environment).toBe("production");
  expect(enforced.sslMode).toBe("verify-full");
  expect(enforced.name).toBe("Mein Reporting");
  expect(enforced.connectionString).toBe("mssql://user:pw@db.internal/app?encrypt=true");
  expect(enforced.commandTunnel).toBeNull();
});

test("cloud providers, integrated authentication and team runbooks are supported without local credential files", () => {
  for (const kind of ["bigquery", "s3", "athena", "dynamodb", "sqlite_http", "odbc"]) {
    const result = mergeTeamConnections([], "file", [
      {
        id: kind,
        name: kind,
        kind,
        connectionString: `${kind}://host/db`,
        owner: "DBA",
        contact: "IT",
        runbook: "https://internal/runbook",
      },
    ]);
    expect(result.added).toBe(1);
    expect(result.connections[0].owner).toBe("DBA");
  }
  const source = {
    id: "windows",
    name: "Windows",
    kind: "mssql",
    connectionString: "mssql://host/db?trusted_connection=true",
  };
  expect(mergeTeamConnections([], "file", [source]).added).toBe(1);
  expect(
    mergeTeamConnections([], "file", [
      { ...source, connectionString: "mssql://host/db?trusted_connection=untrusted" },
    ]).added,
  ).toBe(0);
  expect(
    mergeTeamConnections([], "file", [
      { ...source, connectionString: "mssql://host/db?sslkey=/tmp/key" },
    ]).added,
  ).toBe(0);
});

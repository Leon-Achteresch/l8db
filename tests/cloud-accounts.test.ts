import { beforeEach, describe, expect, mock, test } from "bun:test";

const calls: { command: string; args?: Record<string, unknown> }[] = [];
const handlers = new Map<string, (args?: Record<string, unknown>) => unknown>();

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    const handler = handlers.get(command);
    return handler ? handler(args) : null;
  },
}));

const cloud = await import("../src/lib/db/cloud-accounts");
const { parseReducerArgument } = await import("../src/features/cloud-accounts/reducer-arguments");
const { addCloudConnection, cloudErrorText } = await import(
  "../src/features/cloud-accounts/add-cloud-connection"
);
const { useConnectionsStore } = await import("../src/lib/connections");

beforeEach(() => {
  calls.length = 0;
  handlers.clear();
});

describe("Cloud-Konten-Bridge", () => {
  test("übergibt Argumente in camelCase und normalisiert leere Werte", async () => {
    await cloud.neonAddApiKey("Firma", "neon-key", "");
    await cloud.neonProjects("acc", { orgId: "", cursor: "c1", search: "  shop " });
    await cloud.neonBranches("acc", "p-1");
    await cloud.neonObjects("acc", "p-1", "br-1", "avatars", "", null);
    await cloud.planetScaleOrganizations("acc");
    await cloud.spacetimeCallReducer("acc", "spiel", "set_nick", ["neo"], true);
    expect(calls).toEqual([
      {
        command: "cloud_neon_add_api_key",
        args: { label: "Firma", apiKey: "neon-key", endpoint: null },
      },
      {
        command: "cloud_neon_projects",
        args: { accountId: "acc", orgId: null, cursor: "c1", search: "shop" },
      },
      {
        command: "cloud_neon_branches",
        args: { accountId: "acc", projectId: "p-1", cursor: null },
      },
      {
        command: "cloud_neon_objects",
        args: {
          accountId: "acc",
          projectId: "p-1",
          branchId: "br-1",
          bucket: "avatars",
          prefix: null,
          cursor: null,
        },
      },
      { command: "cloud_planetscale_organizations", args: { accountId: "acc", page: null } },
      {
        command: "cloud_spacetime_call_reducer",
        args: {
          accountId: "acc",
          database: "spiel",
          reducer: "set_nick",
          args: ["neo"],
          confirmed: true,
        },
      },
    ]);
  });

  test("Anfrageobjekte für Verbindungen und Zugangsdaten bleiben strukturiert", async () => {
    await cloud.neonCreateConnection("acc", {
      projectId: "p-1",
      branchId: "br-1",
      database: "neondb",
      role: "owner",
      pooled: false,
      transport: "neon-ws",
      name: "Neon",
    });
    await cloud.planetScaleCreateCredential("acc", {
      organization: "acme",
      database: "app",
      branch: "main",
      credentialName: null,
      connectionName: "PS",
      confirmed: true,
    });
    expect(calls[0]?.args?.request).toEqual({
      projectId: "p-1",
      branchId: "br-1",
      database: "neondb",
      role: "owner",
      pooled: false,
      transport: "neon-ws",
      name: "Neon",
    });
    expect(calls[1]?.args?.request).toMatchObject({ confirmed: true });
  });

  test("angelegte Verbindungen enthalten kein Passwort und landen im Store", () => {
    const created = {
      id: "6f1c3b2a-0000-4000-8000-000000000001",
      name: "Neon / main",
      kind: "postgres",
      provider_id: "neon",
      connection_string:
        "postgresql://owner@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require&l8db_transport=neon-ws",
      ssl_mode: "require",
    };
    const saved = addCloudConnection(created);
    expect(saved.connectionString).toBe(created.connection_string);
    expect(saved.sslMode).toBe("require");
    expect(JSON.stringify(saved)).not.toContain("password");
    const stored = useConnectionsStore
      .getState()
      .connections.find((connection) => connection.id === created.id);
    expect(stored?.name).toBe("Neon / main");
    addCloudConnection(created);
    expect(
      useConnectionsStore
        .getState()
        .connections.filter((connection) => connection.id === created.id),
    ).toHaveLength(1);
    expect(cloud.savedConnectionFrom({ ...created, ssl_mode: "trust-all" }).sslMode).toBe(
      "require",
    );
  });

  test("Reducer-Argumente werden typgerecht gelesen", () => {
    expect(parseReducerArgument("neo", "String")).toBe("neo");
    expect(parseReducerArgument('"mit \\"quote\\""', "String")).toBe('mit "quote"');
    expect(parseReducerArgument("42", "U32")).toBe(42);
    expect(parseReducerArgument('{"some": 1}', "Option<U8>")).toEqual({ some: 1 });
    expect(() => parseReducerArgument("", "U32")).toThrow();
    expect(() => parseReducerArgument("{kaputt", "U32")).toThrow(SyntaxError);
  });

  test("Fehlertexte bleiben lesbar", () => {
    expect(cloudErrorText(new Error("Neon HTTP 403"))).toBe("Neon HTTP 403");
    expect(cloudErrorText("PlanetScale HTTP 401")).toBe("PlanetScale HTTP 401");
    expect(cloudErrorText({})).toBe("Unbekannter Fehler.");
  });

  test("Abfrageoptionen verhindern Polling und Fokus-Refetch", () => {
    expect(cloud.CLOUD_QUERY_OPTIONS.refetchInterval).toBe(false);
    expect(cloud.CLOUD_QUERY_OPTIONS.refetchOnWindowFocus).toBe(false);
    expect(cloud.CLOUD_QUERY_OPTIONS.refetchOnReconnect).toBe(false);
    expect(cloud.CLOUD_QUERY_OPTIONS.retry).toBe(false);
  });
});

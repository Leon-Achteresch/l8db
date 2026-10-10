import { expect, test } from "bun:test";
import type { SavedConnection } from "../src/lib/connections";
import { useConnectionsStore } from "../src/lib/connections/store";
import { exportPortableWorkspace } from "../src/lib/portable-workspace";
import { useSavedQueriesStore } from "../src/lib/saved-queries";
import { useSettingsStore } from "../src/lib/settings";
import { applyLocal, collectLocal, secretAccounts } from "../src/lib/sync/local";
import { SYNC_COLLECTIONS } from "../src/lib/sync/payload";

const saved: SavedConnection = {
  id: "c1",
  name: "Prod",
  kind: "postgres",
  connectionString: "postgres://app:geheim@db.example.com:5432/app",
  sslMode: "prefer",
  tunnelPort: 41000,
  commandTunnel: { command: "aws ssm start-session" },
};

const temporary: SavedConnection = {
  id: "t1",
  name: "Datei",
  kind: "sqlite",
  connectionString: "/tmp/x.sqlite",
  sslMode: "disable",
  temporary: true,
};

test("collects persisted configuration without secrets, temporaries or device-only fields", () => {
  useConnectionsStore.setState({ connections: [saved, temporary], hostGroupRules: [] });
  useSavedQueriesStore.setState({
    queries: [{ id: "q1", name: "Q", sql: "SELECT 1", createdAt: 1 }],
  });
  const collections = collectLocal(false);
  expect(collections.connections).toHaveLength(1);
  const data = collections.connections[0].data as Record<string, unknown>;
  expect(String(data.connectionString)).not.toContain("geheim");
  expect(data).not.toHaveProperty("tunnelPort");
  expect(data).not.toHaveProperty("commandTunnel");
  expect(collections.history).toEqual([]);
  expect(collections.workspace.map((item) => item.id)).toEqual([
    "settings",
    "hotkeys",
    "layouts",
    "profiles",
    "favorites",
    "views",
  ]);
  const settings = (collections.workspace[0].data as { value: Record<string, unknown> }).value;
  expect(settings).not.toHaveProperty("productionReadOnly");
  expect(settings).not.toHaveProperty("crashReports");
  expect(secretAccounts(collections.connections)).toEqual([
    "c1",
    "c1:ssh",
    "c1:ssh-jumps",
    "c1:proxy",
    "c1:params",
  ]);
});

test("applying remote data keeps live passwords, temporaries and local command tunnels", () => {
  useConnectionsStore.setState({ connections: [saved, temporary], activeId: "c1" });
  const collections = collectLocal(false);
  const renamed = { ...(collections.connections[0].data as object), name: "Prod (neu)" };
  collections.connections = [{ id: "c1", data: renamed }];
  collections.savedQueries = [];
  const workspace = exportPortableWorkspace();
  collections.workspace = [
    { id: "settings", data: { value: { ...workspace.settings, rowLimit: 777 } } },
  ];
  applyLocal(collections, new Set(SYNC_COLLECTIONS.filter((c) => c !== "history")));
  const [first, second] = useConnectionsStore.getState().connections;
  expect(first.name).toBe("Prod (neu)");
  expect(first.connectionString).toContain("geheim");
  expect(first.commandTunnel?.command).toBe("aws ssm start-session");
  expect(second.id).toBe("t1");
  expect(useConnectionsStore.getState().activeId).toBe("c1");
  expect(useSavedQueriesStore.getState().queries).toEqual([]);
  expect(useSettingsStore.getState().rowLimit).toBe(777);
});

test("invalid remote workspace settings are rejected before any store changes", () => {
  useSavedQueriesStore.setState({
    queries: [{ id: "q1", name: "Q", sql: "SELECT 1", createdAt: 1 }],
  });
  const collections = collectLocal(false);
  collections.savedQueries = [];
  collections.workspace = [{ id: "settings", data: { value: { rowLimit: "viele" } } }];
  expect(() => applyLocal(collections, new Set(SYNC_COLLECTIONS))).toThrow();
  expect(useSavedQueriesStore.getState().queries).toHaveLength(1);
});

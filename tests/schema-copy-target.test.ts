import { expect, mock, test } from "bun:test";

const calls: { command: string; args: Record<string, unknown> }[] = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    calls.push({ command, args });
    if (command === "list_providers") return [];
    if (command === "open_ssh_tunnel") return { local_port: 41000 };
    if (command === "list_ssh_tunnels") return [];
    if (command === "list_schemas") return ["EUROTIME", "LAGER"];
    return null;
  },
}));

const { useConnectionsStore } = await import("../src/lib/connections");
const { loadCopyTargetSchemas } = await import("../src/lib/schema-copy");

const active = {
  id: "active",
  name: "Aktiv",
  kind: "postgres" as const,
  connectionString: "postgresql://u:pw@localhost:5432/app",
};
const other = {
  id: "other",
  name: "Andere",
  kind: "postgres" as const,
  connectionString: "postgresql://u:pw@db.internal:5432/app",
  ssh: {
    host: "bastion.example.com",
    port: 22,
    user: "root",
    auth: "key" as const,
    keyFile: "/tmp/test-key",
    remoteHost: "db.internal",
    remotePort: 5432,
  },
};

test("loads schemas of an inactive tunneled target by opening its tunnel first", async () => {
  useConnectionsStore.setState({ connections: [active, other], activeId: "active" });
  expect(await loadCopyTargetSchemas("other", "active", "app")).toEqual(["EUROTIME", "LAGER"]);
  const commands = calls.map((call) => call.command);
  expect(commands.indexOf("open_ssh_tunnel")).toBeLessThan(commands.indexOf("list_schemas"));
  const list = calls.find((call) => call.command === "list_schemas");
  expect(String(list?.args.connectionString)).toBe(
    "postgresql://u:pw@db.internal:41000/app?hostaddr=127.0.0.1",
  );
  expect(list?.args.database).toBeUndefined();
});

test("same connection keeps the selected database", async () => {
  calls.length = 0;
  await loadCopyTargetSchemas("active", "active", "app");
  expect(calls.find((call) => call.command === "list_schemas")?.args.database).toBe("app");
});

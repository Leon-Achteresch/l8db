import { beforeEach, expect, mock, test } from "bun:test";

const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
const handlers = new Map<string, (args: Record<string, unknown>) => unknown>();
const fsReads: string[] = [];
const files = new Map<string, string>();
let picked: string | string[] | null = null;

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    const handler = handlers.get(command);
    return handler ? handler(args) : null;
  },
}));

mock.module("@tauri-apps/plugin-dialog", () => ({
  open: async () => picked,
}));

mock.module("@tauri-apps/plugin-fs", () => ({
  readTextFile: async (path: string) => {
    fsReads.push(path);
    const text = files.get(path);
    if (text === undefined) throw new Error(`forbidden path: ${path}`);
    return text;
  },
  readFile: async (path: string) => {
    fsReads.push(path);
    throw new Error(`forbidden path: ${path}`);
  },
}));

const { addDataGripSshConfigs, detectDbeaverImport, pickExternalImport } = await import(
  "../src/features/connections/connection-import/load-external-import"
);

const CREDENTIALS = Array.from(
  Buffer.from(
    "AAECAwQFBgcICQoLDA0ODz5TPlgh6DpNnKqkJUAkSBOS3K7zn7EuJ6cGXtL3R55eTLeaO9c+g6TvUWHehtWfUDpn66kbIhIvepYGCBjrYNuu/LegynTpu+aKkGMd9as0ZX58VY93b5+DJ/7jrSnaST9CalfRi6G0jdP4aUpOZCvmepH1A+nNUoPuIuKdf6Q8nq0Q2yLAkjb52uAnP3ncZ3N8oAqWi77ubCsPqmAv/alBJSN6M7/dqaFvG0dc7ntenB++8ypU0G52WAOP1G7TCVwRiwNKi7JYCeMyCUNi6cePMywVK0eHOEAeFSMcRhlR",
    "base64",
  ),
);

const DATA_SOURCES = JSON.stringify({
  connections: {
    "postgres-jdbc-prod": {
      provider: "postgresql",
      driver: "postgres-jdbc",
      name: "Prod",
      configuration: { host: "db", database: "app" },
    },
  },
});

const SHARED = `<project><component name="DataSourceManagerImpl"><data-source name="via ssh" uuid="d1"><driver-ref>postgresql</driver-ref><jdbc-url>jdbc:postgresql://10.0.0.1/app</jdbc-url></data-source></component></project>`;

const LOCAL = `<project><component name="dataSourceStorageLocal"><data-source name="via ssh" uuid="d1"><user-name>app</user-name><ssh-properties><enabled>true</enabled><ssh-config-id>cfg-1</ssh-config-id></ssh-properties></data-source></component></project>`;

const SSH = `<application><component name="SshConfigs"><configs><sshConfig authType="PASSWORD" host="bastion" id="cfg-1" port="22" username="ops"/></configs></component></application>`;

beforeEach(() => {
  calls.length = 0;
  fsReads.length = 0;
  handlers.clear();
  files.clear();
  picked = null;
});

test("auto-detects the DBeaver workspace through the narrow Rust command", async () => {
  handlers.set("detect_dbeaver_workspace", () => ({
    data_sources_path:
      "/home/u/.local/share/DBeaverData/workspace6/General/.dbeaver/data-sources.json",
    data_sources: DATA_SOURCES,
    credentials: CREDENTIALS,
  }));
  const loaded = await detectDbeaverImport();
  expect(calls.map((call) => call.command)).toEqual(["detect_dbeaver_workspace"]);
  expect(fsReads).toEqual([]);
  expect(loaded?.files).toEqual(["data-sources.json", "credentials-config.json"]);
  expect(loaded?.result.notice).toBeNull();
  expect(loaded?.result.connections[0]).toMatchObject({ user: "app_owner", password: "Pg$ecret!" });
  handlers.set("detect_dbeaver_workspace", () => null);
  expect(await detectDbeaverImport()).toBeNull();
});

test("reads credentials next to a picked data-sources.json in a hidden directory", async () => {
  picked = "/home/u/.local/share/DBeaverData/workspace6/General/.dbeaver/data-sources.json";
  handlers.set("read_dbeaver_workspace", (args) => ({
    data_sources_path: args.path,
    data_sources: DATA_SOURCES,
    credentials: CREDENTIALS,
  }));
  const loaded = await pickExternalImport("dbeaver");
  expect(calls).toEqual([{ command: "read_dbeaver_workspace", args: { path: picked } }]);
  expect(fsReads).toEqual([]);
  expect(loaded?.result.connections[0].password).toBe("Pg$ecret!");
});

test("resolves DataGrip SSH configs from the detected JetBrains options directory", async () => {
  files.set("/p/.idea/dataSources.xml", SHARED);
  files.set("/p/.idea/dataSources.local.xml", LOCAL);
  picked = ["/p/.idea/dataSources.xml", "/p/.idea/dataSources.local.xml"];
  handlers.set("detect_jetbrains_ssh_configs", () => [
    {
      name: "sshConfigs.xml",
      path: "/home/u/.config/JetBrains/DataGrip/options/sshConfigs.xml",
      text: SSH,
    },
  ]);
  const loaded = await pickExternalImport("datagrip");
  expect(loaded?.needsSshConfigs).toBe(false);
  expect(loaded?.result.connections[0].ssh).toMatchObject({ host: "bastion", user: "ops" });
  expect(loaded?.files).toEqual(["dataSources.xml", "dataSources.local.xml", "sshConfigs.xml"]);
});

test("lets the user add sshConfigs.xml from a second directory when detection finds nothing", async () => {
  files.set("/p/.idea/dataSources.xml", SHARED);
  files.set("/p/.idea/dataSources.local.xml", LOCAL);
  files.set("/elsewhere/options/sshConfigs.xml", SSH);
  picked = ["/p/.idea/dataSources.xml", "/p/.idea/dataSources.local.xml"];
  handlers.set("detect_jetbrains_ssh_configs", () => []);
  const first = await pickExternalImport("datagrip");
  expect(first?.needsSshConfigs).toBe(true);
  expect(first?.result.connections[0].ssh).toBeNull();
  picked = ["/elsewhere/options/sshConfigs.xml"];
  const second = await addDataGripSshConfigs(first?.dataGripFiles ?? []);
  expect(second?.needsSshConfigs).toBe(false);
  expect(second?.result.connections[0].ssh).toMatchObject({ host: "bastion", auth: "password" });
  expect(calls.filter((call) => call.command === "detect_jetbrains_ssh_configs")).toHaveLength(1);
});

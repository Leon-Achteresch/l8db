import { describe, expect, mock, test } from "bun:test";
import type { Json, L8dbApi, ProcessOptions, VaultConnection } from "../packages/extension-api/src";

const keychain = new Map<string, string>();
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, string>) => {
    if (command === "store_secret") keychain.set(args.account, args.secret);
    if (command === "load_secret") return keychain.get(args.account) ?? null;
    return null;
  },
  Resource: class {},
  Channel: class {},
  transformCallback: () => 0,
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

const { mergeVaultConnections, toVaultConnection } = await import(
  "../src/lib/connection-export/vault"
);
const extension = await import("../extention/password-manager/src/extension");

const saved = {
  id: "11111111-2222-3333-4444-555555555555",
  name: "Prod DB",
  kind: "postgres" as const,
  connectionString: "postgres://app:s3cr%40t%20pw@db.example.com:5432/prod?application_name=l8db",
  sslMode: "require" as const,
  ssh: null,
  proxy: null,
  tunnelPort: null,
  tags: [{ name: "prod", color: "#ef4444" }],
  favorite: true,
  color: "#ef4444",
  schemas: null,
  showSingleSchemaSwitcher: true,
  readOnly: true,
};

describe("vault connection mapping", () => {
  test("round-trips a connection with its password", () => {
    const vault = toVaultConnection(saved, null);
    expect(vault.password).toBe("s3cr@t pw");
    expect(vault.connectionString).not.toContain("s3cr");
    const fresh = mergeVaultConnections([vault], []);
    expect(fresh.added).toHaveLength(1);
    expect(fresh.added[0].connectionString).toBe(saved.connectionString);
    expect(fresh.added[0].tags).toEqual(saved.tags);
    expect(fresh.passwords.get(saved.id)).toBe("s3cr@t pw");
  });

  test("updates an existing connection in place and keeps local-only settings", () => {
    const vault = { ...toVaultConnection(saved, null), password: "rotated" };
    const merge = mergeVaultConnections([vault], [saved]);
    expect(merge.added).toHaveLength(0);
    expect(merge.updated[0].id).toBe(saved.id);
    expect(merge.updated[0].readOnly).toBe(true);
    expect(merge.updated[0].connectionString).toContain(":rotated@");
  });

  test("uses the keychain password when the URL has none", () => {
    const vault = toVaultConnection(
      { ...saved, connectionString: "postgres://app@db/prod" },
      "fromKeychain",
    );
    expect(vault.password).toBe("fromKeychain");
  });

  test("skips malformed entries", () => {
    const merge = mergeVaultConnections(
      [
        {
          id: "x",
          name: "Broken",
          kind: "postgres",
          connectionString: "x",
          password: null,
          profile: null as unknown as Json,
        },
        {
          id: "y",
          name: "Bad kind",
          kind: "nope",
          connectionString: "x",
          password: null,
          profile: { id: "y", name: "Bad kind", kind: "nope", connectionString: "x" },
        },
      ],
      [],
    );
    expect(merge.added).toHaveLength(0);
    expect(merge.skipped).toEqual(["Broken", "Bad kind"]);
  });
});

type Cli = (
  args: string[],
  env?: Record<string, string>,
) => { status: number; stdout: string; stderr?: string };

function decodeB64(value: string) {
  return new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));
}

function fakeKeeper() {
  const records = new Map<
    string,
    { title: string; notes: string; login: string; password: string }
  >();
  let next = 1;
  const field = (args: string[], name: string) => {
    const raw = args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
    return raw.startsWith("$BASE64:") ? decodeB64(raw.slice(8)) : raw;
  };
  const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];
  const cli: Cli = (all) => {
    expect(all[0]).toBe("--batch-mode");
    const [command, ...args] = all.slice(1);
    if (command === "search")
      return {
        status: 0,
        stdout: JSON.stringify(
          [...records].map(([uid, r]) => ({
            type: "record",
            record_uid: uid,
            record_type: "login",
            title: r.title,
          })),
        ),
      };
    if (command === "get") {
      const r = records.get(args[0]);
      if (!r) return { status: 1, stdout: "", stderr: "not found" };
      return {
        status: 0,
        stdout: JSON.stringify({
          record_uid: args[0],
          title: r.title,
          type: "login",
          fields: [
            { type: "login", value: [r.login] },
            { type: "password", value: [r.password] },
          ],
          custom: [],
          notes: r.notes,
        }),
      };
    }
    if (command === "record-add") {
      const uid = `UID${next++}`;
      records.set(uid, {
        title: flag(args, "-t"),
        notes: flag(args, "-n"),
        login: field(args, "login"),
        password: field(args, "password"),
      });
      return { status: 0, stdout: uid };
    }
    if (command === "record-update") {
      const uid = flag(args, "-r");
      records.set(uid, {
        title: flag(args, "-t"),
        notes: flag(args, "-n"),
        login: field(args, "login"),
        password: field(args, "password"),
      });
      return { status: 0, stdout: "" };
    }
    return { status: 1, stdout: "", stderr: `unknown ${command}` };
  };
  return { cli, records };
}

function fakeBitwarden() {
  const items = new Map<string, Record<string, unknown>>();
  let next = 1;
  const cli: Cli = (args, env) => {
    const [command, ...rest] = args;
    if (command === "status") return { status: 0, stdout: JSON.stringify({ status: "locked" }) };
    if (command === "unlock") {
      expect(env?.L8DB_BW_PASSWORD).toBe("master");
      return { status: 0, stdout: "SESSION" };
    }
    expect(rest.slice(-2)).toEqual(["--session", "SESSION"]);
    if (command === "sync") return { status: 0, stdout: "Syncing complete." };
    if (command === "list") return { status: 0, stdout: JSON.stringify([...items.values()]) };
    if (command === "create") {
      const id = `bw-${next++}`;
      items.set(id, { ...JSON.parse(decodeB64(rest[1])), id });
      return { status: 0, stdout: "{}" };
    }
    if (command === "edit") {
      items.set(rest[1], { ...JSON.parse(decodeB64(rest[2])), id: rest[1] });
      return { status: 0, stdout: "{}" };
    }
    return { status: 1, stdout: "", stderr: "unknown" };
  };
  return { cli, items };
}

function fakeOnePassword() {
  const items = new Map<string, { title: string; values: Record<string, string> }>();
  let next = 1;
  const values = (args: string[]) =>
    Object.fromEntries(
      args
        .filter((arg) => /^(username|password|notesPlain)=/.test(arg))
        .map((arg) => [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]),
    );
  const cli: Cli = (args) => {
    const [, command, ...rest] = args;
    if (command === "list")
      return {
        status: 0,
        stdout: JSON.stringify(
          [...items].map(([id, item]) => ({ id, title: item.title, tags: ["l8db"] })),
        ),
      };
    if (command === "get") {
      const item = items.get(rest[0]);
      if (!item) return { status: 1, stdout: "", stderr: "not found" };
      return {
        status: 0,
        stdout: JSON.stringify({
          id: rest[0],
          title: item.title,
          fields: Object.entries(item.values).map(([id, value]) => ({
            id,
            value,
            purpose: id === "notesPlain" ? "NOTES" : id.toUpperCase(),
          })),
        }),
      };
    }
    if (command === "create") {
      items.set(`op-${next++}`, { title: rest[rest.indexOf("--title") + 1], values: values(rest) });
      return { status: 0, stdout: "{}" };
    }
    if (command === "edit") {
      items.set(rest[0], { title: rest[rest.indexOf("--title") + 1], values: values(rest) });
      return { status: 0, stdout: "{}" };
    }
    return { status: 1, stdout: "", stderr: "unknown" };
  };
  return { cli, items };
}

function harness(provider: string, clis: Record<string, Cli>, local: VaultConnection[]) {
  const handlers = new Map<string, () => Promise<void>>();
  const messages: string[] = [];
  const savedBatches: VaultConnection[][] = [];
  const api = {
    commands: {
      registerCommand(id: string, handler: () => Promise<void>) {
        handlers.set(id, handler);
        return { dispose: () => handlers.delete(id) };
      },
    },
    configuration: { get: async () => provider },
    connections: {
      list: async () => local,
      save: async (items: VaultConnection[]) => {
        savedBatches.push(items);
        return { added: items.length, updated: 0, skipped: [] };
      },
    },
    process: {
      run: async (command: string, options: ProcessOptions = {}) => {
        const cli = clis[command];
        if (!cli) throw new Error(`not allowed: ${command}`);
        return { stderr: "", ...cli(options.args ?? [], options.env) };
      },
    },
    window: {
      showQuickPick: async (items: { picked?: boolean }[]) =>
        items.filter((item) => item.picked).map((item) => ({ ...item })),
      showInputBox: async () => "master",
      showInformationMessage: async (message: string) => {
        messages.push(message);
        return undefined;
      },
      showErrorMessage: async (message: string) => {
        messages.push(`ERROR ${message}`);
        return undefined;
      },
    },
  } as unknown as L8dbApi;
  extension.activate(
    { extensionId: "l8db.password-manager", extensionPath: "", storagePath: "", subscriptions: [] },
    api,
  );
  return { run: (id: string) => handlers.get(id)!(), messages, savedBatches };
}

const local: VaultConnection[] = [
  toVaultConnection(saved, null),
  toVaultConnection(
    {
      ...saved,
      id: "22222222-2222-3333-4444-555555555555",
      name: 'Käse & Wurst "dev"',
      connectionString: "mysql://root:p=a;ss$w0rd%5Cn@localhost:3306/dev",
      kind: "mysql" as never,
    },
    null,
  ),
];

describe.each([
  ["keeper", () => fakeKeeper(), "keeper"],
  ["bitwarden", () => fakeBitwarden(), "bw"],
  ["1password", () => fakeOnePassword(), "op"],
] as const)("%s backend", (provider, create, binary) => {
  test("saves connections, updates them in place and loads them back", async () => {
    const fake = create();
    const vault = harness(provider, { [binary]: fake.cli }, local);
    await vault.run("vault.export");
    expect(vault.messages.at(-1)).toContain("2 angelegt, 0 aktualisiert");
    const store = "records" in fake ? fake.records : fake.items;
    expect(store.size).toBe(2);
    await vault.run("vault.export");
    expect(vault.messages.at(-1)).toContain("0 angelegt, 2 aktualisiert");
    expect(store.size).toBe(2);
    await vault.run("vault.import");
    expect(vault.messages.at(-1)).not.toContain("ERROR");
    const loaded = vault.savedBatches[0].sort((a, b) => a.name.localeCompare(b.name));
    const expected = [...local].sort((a, b) => a.name.localeCompare(b.name));
    expect(loaded).toEqual(expected);
    expect(loaded.map((entry) => entry.password)).toEqual(["p=a;ss$w0rd\\n", "s3cr@t pw"]);
    const merged = mergeVaultConnections(loaded, []);
    expect(merged.added.find((c) => c.id === saved.id)?.connectionString).toBe(
      saved.connectionString,
    );
  });

  test("imports duplicate vault records only once", async () => {
    const fake = create();
    const vault = harness(provider, { [binary]: fake.cli }, [local[0]]);
    await vault.run("vault.export");
    const store: Map<string, unknown> = "records" in fake ? fake.records : fake.items;
    const [first] = [...store.values()];
    store.set("duplicate", structuredClone(first));
    await vault.run("vault.import");
    expect(vault.savedBatches[0].map((entry) => entry.id)).toEqual([local[0].id]);
  });

  test("reports CLI failures instead of throwing", async () => {
    const vault = harness(
      provider,
      { [binary]: () => ({ status: 1, stdout: "", stderr: "Not logged in" }) },
      local,
    );
    await vault.run("vault.import");
    expect(vault.messages.at(-1)).toStartWith("ERROR");
  });
});

test("host saves into the connection store and keychain and lists them back", async () => {
  const { createExtensionHost } = await import("../src/lib/extensions/host");
  const { useConnectionsStore } = await import("../src/lib/connections");
  const core = (
    createExtensionHost().manager as unknown as {
      core: import("../src/lib/extensions/contracts").CoreServices;
    }
  ).core;
  useConnectionsStore.setState({
    connections: [{ ...saved, connectionString: "postgres://app@db.example.com:5432/prod" }],
  });
  const result = await core.saveConnections([
    { ...toVaultConnection(saved, null), password: "rotated" },
    { ...local[1], password: "new-secret" },
  ]);
  expect(result).toEqual({ added: 1, updated: 1, skipped: [] });
  const { connections } = useConnectionsStore.getState();
  expect(connections).toHaveLength(2);
  expect(connections[0].readOnly).toBe(true);
  expect(connections[0].connectionString).toContain("app:rotated@");
  expect(keychain.get(saved.id)).toBe("rotated");
  expect(keychain.get(local[1].id)).toBe("new-secret");
  expect(
    JSON.parse(storage.get("l8db.connections") ?? "{}").state.connections[0].connectionString,
  ).not.toContain("rotated");
  const listed = await core.listConnections();
  expect(listed.map((entry) => entry.password)).toEqual(["rotated", "new-secret"]);
});

test("ignores unrelated vault entries", () => {
  expect(extension.fromNotes("just a note", "pw")).toBeNull();
  expect(extension.fromNotes(`${extension.MARKER}not-base64!!`, "pw")).toBeNull();
  const notes = extension.toNotes(local[0]);
  expect(notes).not.toContain("s3cr");
  expect(extension.fromNotes(`header\n${notes}`, "pw")?.id).toBe(saved.id);
});

describe("CLI installation", () => {
  function installApi(
    available: Record<
      string,
      (args: string[]) => { status: number; stdout?: string; stderr?: string }
    >,
  ) {
    const calls: string[] = [];
    const trees: unknown[][] = [];
    const api = {
      process: {
        run: async (command: string, options: ProcessOptions = {}) => {
          calls.push([command, ...(options.args ?? [])].join(" "));
          const handler = available[command];
          if (!handler) throw new Error("No such file or directory");
          return { stdout: "", stderr: "", ...handler(options.args ?? []) };
        },
      },
      views: { setTreeData: async (_id: string, items: unknown[]) => void trees.push(items) },
    } as unknown as L8dbApi;
    return { api, calls, trees };
  }

  test("falls back to the next package manager and verifies the binary", async () => {
    let installed = false;
    const { api, calls } = installApi({
      pipx: () => ({ status: 1, stderr: "pipx broken" }),
      python3: () => {
        installed = true;
        return { status: 0 };
      },
      keeper: () =>
        installed ? { status: 0, stdout: "Commander Version: 17.1.0" } : { status: 1 },
    });
    expect(await extension.installCli(api, "keeper")).toBe("Commander Version: 17.1.0");
    expect(calls).toEqual([
      "pipx install keepercommander",
      "python3 -m pip install --user keepercommander",
      "keeper --version",
    ]);
  });

  test("keeper falls back to a private venv", async () => {
    const { api, calls } = installApi({});
    await expect(extension.installCli(api, "keeper")).rejects.toThrow("docs.keeper.io");
    expect(calls.map((call) => call.split(" ")[0])).toEqual(["pipx", "python3", "sh", "py"]);
  });

  test("skips missing package managers and reports a manual link", async () => {
    const { api, calls } = installApi({});
    await expect(extension.installCli(api, "1password")).rejects.toThrow("developer.1password.com");
    expect(calls.map((call) => call.split(" ")[0])).toEqual(["brew", "winget", "sh"]);
  });

  test("the sidebar offers an install button only for missing CLIs", async () => {
    const { api, trees } = installApi({ bw: () => ({ status: 0, stdout: "2026.9.0" }) });
    const handlers = new Map<string, (payload?: unknown) => Promise<unknown>>();
    Object.assign(api, {
      commands: {
        registerCommand: (id: string, handler: (payload?: unknown) => Promise<unknown>) => (
          handlers.set(id, handler), { dispose() {} }
        ),
      },
      configuration: { get: async () => "keeper" },
      window: {
        showErrorMessage: async () => undefined,
        showInformationMessage: async () => undefined,
      },
    });
    extension.activate(
      { extensionId: "x", extensionPath: "", storagePath: "", subscriptions: [] },
      api,
    );
    await handlers.get("vault.refresh")?.();
    const tree = trees.at(-1) as {
      id: string;
      description?: string;
      command?: string;
      commandArguments?: string;
    }[];
    expect(tree.find((item) => item.id === "bitwarden")).toMatchObject({ description: "2026.9.0" });
    expect(tree.find((item) => item.id === "bitwarden")?.command).toBeUndefined();
    expect(tree.find((item) => item.id === "keeper")).toMatchObject({
      command: "vault.install",
      commandArguments: "keeper",
    });
  });
});

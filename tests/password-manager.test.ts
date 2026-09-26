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
    expect(await extension.installCli(api, "keeper")).toBe("17.1.0");
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

describe("vault setup", () => {
  const api = (clis: Record<string, Cli>, calls: string[][] = []) =>
    ({
      process: {
        run: async (command: string, options: ProcessOptions = {}) => {
          calls.push([command, ...(options.args ?? [])]);
          const cli = clis[command];
          if (!cli) throw new Error(`not allowed: ${command}`);
          return { stderr: "", ...cli(options.args ?? [], options.env) };
        },
      },
    }) as unknown as L8dbApi;
  const version = { status: 0, stdout: "1.0.0" };

  test("bitwarden asks for a two-step code, then signs in and keeps the session", async () => {
    let state = "unauthenticated";
    const calls: string[][] = [];
    const bw: Cli = (args, env) => {
      if (args[0] === "--version") return version;
      if (args[0] === "status")
        return {
          status: 0,
          stdout: JSON.stringify({
            status: args.includes("SESSION") && state === "unlocked" ? "unlocked" : state,
            userEmail: state === "unauthenticated" ? null : "me@example.com",
          }),
        };
      if (args[0] === "config") return { status: 0, stdout: "Saved setting `config`." };
      if (args[0] === "login") {
        expect(env?.L8DB_BW_PASSWORD).toBe("master");
        if (!args.includes("--code")) return { status: 1, stdout: "Code is required." };
        state = "unlocked";
        return { status: 0, stdout: "SESSION\n" };
      }
      if (args[0] === "sync") return { status: 0, stdout: "Syncing complete." };
      return { status: 1, stdout: "", stderr: "unknown" };
    };
    const auth = { bw: null, op: null };
    const input = {
      action: "login",
      provider: "bitwarden",
      email: "me@example.com",
      password: "master",
      server: "https://vault.bitwarden.eu",
    };
    const first = await extension.vaultSetup(api({ bw }, calls), auth, input, "keeper");
    expect(first).toMatchObject({ state: "signed-out", needs: "code" });
    expect(calls).toContainEqual(["bw", "config", "server", "https://vault.bitwarden.eu"]);
    const second = await extension.vaultSetup(
      api({ bw }, calls),
      auth,
      { ...input, code: "123456", method: "0" },
      "keeper",
    );
    expect(second).toMatchObject({ state: "signed-in", account: "me@example.com", cli: "1.0.0" });
    expect(second.needs).toBeUndefined();
    expect(auth.bw).toBe("SESSION");
    expect(calls).toContainEqual(["bw", "sync", "--session", "SESSION"]);
  });

  test("bitwarden unlocks a logged-in vault with the master password only", async () => {
    let unlocked = false;
    const bw: Cli = (args, env) => {
      if (args[0] === "--version") return version;
      if (args[0] === "status")
        return { status: 0, stdout: JSON.stringify({ status: unlocked ? "unlocked" : "locked" }) };
      if (args[0] === "login") throw new Error("must not log in again");
      if (args[0] === "unlock") {
        expect(env?.L8DB_BW_PASSWORD).toBe("master");
        unlocked = true;
        return { status: 0, stdout: "S2" };
      }
      return { status: 0, stdout: "" };
    };
    const auth = { bw: null, op: null };
    const status = await extension.vaultSetup(
      api({ bw }),
      auth,
      { action: "login", password: "master" },
      "bitwarden",
    );
    expect(status.state).toBe("signed-in");
    expect(auth.bw).toBe("S2");
  });

  test("keeper registers a persistent login and falls back to the terminal on prompts", async () => {
    const calls: string[][] = [];
    let loggedIn = false;
    const keeper: Cli = (args, env) => {
      if (args[0] === "--version") return { status: 0, stdout: "Keeper Commander, version 17.0" };
      if (args.includes("login-status"))
        return { status: 0, stdout: loggedIn ? "Logged in\n" : "Not logged in\n" };
      if (args.includes("whoami"))
        return { status: 0, stdout: JSON.stringify({ user: "me@example.com", data_center: "EU" }) };
      expect(env?.KEEPER_PASSWORD).toBe("pw");
      if (args.includes("timeout")) loggedIn = true;
      return { status: 0, stdout: "" };
    };
    const input = { action: "login", email: "me@example.com", password: "pw", server: "EU" };
    const ok = await extension.vaultSetup(
      api({ keeper }, calls),
      { bw: null, op: null },
      input,
      "keeper",
    );
    expect(ok).toMatchObject({
      state: "signed-in",
      cli: "17.0",
      account: "me@example.com",
      server: "EU",
    });
    expect(ok.needs).toBeUndefined();
    expect(
      calls.filter((call) => call.includes("this-device")).map((call) => call.slice(7)),
    ).toEqual([["register"], ["persistent-login", "on"], ["timeout", "30d"]]);
    const denied: Cli = (args) =>
      args[0] === "--version"
        ? version
        : args.includes("login-status")
          ? { status: 0, stdout: "Not logged in" }
          : { status: 1, stdout: "", stderr: "Device approval required" };
    const fallback = await extension.vaultSetup(
      api({ keeper: denied }),
      { bw: null, op: null },
      input,
      "keeper",
    );
    expect(fallback).toMatchObject({ state: "signed-out", needs: "terminal" });
    const silent: Cli = (args) =>
      args[0] === "--version"
        ? version
        : args.includes("login-status")
          ? { status: 0, stdout: "Not logged in" }
          : {
              status: 0,
              stdout: "Persistent login is not working in this non-interactive environment",
            };
    const quiet = await extension.vaultSetup(
      api({ keeper: silent }),
      { bw: null, op: null },
      input,
      "keeper",
    );
    expect(quiet).toMatchObject({ state: "signed-out", needs: "terminal" });
  });

  test("1password explains the app integration when no account is known", async () => {
    const empty: Cli = (args) => (args[0] === "--version" ? version : { status: 0, stdout: "[]" });
    await expect(
      extension.vaultSetup(
        api({ op: empty }),
        { bw: null, op: null },
        { action: "login" },
        "1password",
      ),
    ).rejects.toThrow("Mit 1Password CLI integrieren");
    const auth = { bw: null, op: null };
    let authorized = false;
    const op: Cli = (args) => {
      if (args[0] === "--version") return version;
      if (args[0] === "account")
        return {
          status: 0,
          stdout: JSON.stringify([
            { account_uuid: "A1", email: "me@example.com", url: "my.1password.eu" },
          ]),
        };
      if (args[0] === "whoami")
        return authorized
          ? {
              status: 0,
              stdout: JSON.stringify({ email: "me@example.com", url: "my.1password.eu" }),
            }
          : { status: 1, stdout: "", stderr: "account is not signed in" };
      if (args[0] === "vault") {
        authorized = true;
        return { status: 0, stdout: "[]" };
      }
      return { status: 1, stdout: "", stderr: "unknown" };
    };
    const before = await extension.vaultSetup(api({ op }), auth, {}, "1password");
    expect(before).toMatchObject({ state: "locked", accounts: [{ id: "A1" }] });
    const after = await extension.vaultSetup(
      api({ op }),
      auth,
      { action: "login", account: "A1" },
      "1password",
    );
    expect(after).toMatchObject({ state: "signed-in", account: "me@example.com" });
    expect(auth.op).toBe("A1");
  });

  test("reports a missing CLI without probing the account", async () => {
    const calls: string[][] = [];
    const status = await extension.vaultSetup(
      api({}, calls),
      { bw: null, op: null },
      {},
      "bitwarden",
    );
    expect(status).toEqual({ provider: "bitwarden", cli: null, state: "signed-out" });
    expect(calls).toEqual([["bw", "--version"]]);
  });
});

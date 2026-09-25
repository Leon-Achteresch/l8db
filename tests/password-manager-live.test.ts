import { expect, test } from "bun:test";
import { activate } from "../extention/password-manager/src/extension";
import type { L8dbApi, ProcessOptions, VaultConnection } from "../packages/extension-api/src";

const master = process.env.L8DB_BW_MASTER_PASSWORD;

test.skipIf(!master)(
  "bitwarden CLI round-trip against a real vault",
  async () => {
    const handlers = new Map<string, () => Promise<void>>();
    const messages: string[] = [];
    const loaded: VaultConnection[][] = [];
    const stamp = Date.now();
    const local: VaultConnection[] = [
      {
        id: `live-${stamp}`,
        name: `Live ${stamp}`,
        kind: "postgres",
        connectionString: "postgres://app@db.example.com:5432/prod",
        password: `pä$$ "w0rd" -n ${stamp}`,
        profile: {
          id: `live-${stamp}`,
          name: `Live ${stamp}`,
          kind: "postgres",
          connectionString: "postgres://app@db.example.com:5432/prod",
        },
      },
    ];
    const api = {
      commands: {
        registerCommand(id: string, handler: () => Promise<void>) {
          handlers.set(id, handler);
          return { dispose: () => handlers.delete(id) };
        },
      },
      configuration: { get: async () => "bitwarden" },
      connections: {
        list: async () => local,
        save: async (items: VaultConnection[]) => {
          loaded.push(items);
          return { added: items.length, updated: 0, skipped: [] };
        },
      },
      process: {
        run: async (command: string, options: ProcessOptions = {}) => {
          expect(command).toBe("bw");
          const child = Bun.spawn([command, ...(options.args ?? [])], {
            env: { ...process.env, ...options.env },
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, status] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
          ]);
          return { status, stdout, stderr };
        },
      },
      window: {
        showQuickPick: async (items: { picked?: boolean }[]) => items.filter((item) => item.picked),
        showInputBox: async () => master,
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
    activate(
      {
        extensionId: "l8db.password-manager",
        extensionPath: "",
        storagePath: "",
        subscriptions: [],
      },
      api,
    );

    await handlers.get("vault.export")!();
    expect(messages.at(-1)).toContain("1 angelegt, 0 aktualisiert");
    local[0] = { ...local[0], password: `rotated-${stamp}` };
    await handlers.get("vault.export")!();
    expect(messages.at(-1)).toContain("0 angelegt, 1 aktualisiert");
    await handlers.get("vault.import")!();
    expect(messages.at(-1)).not.toStartWith("ERROR");
    const mine = loaded[0].filter((entry) => entry.id === local[0].id);
    expect(mine).toEqual([local[0]]);
  },
  180000,
);

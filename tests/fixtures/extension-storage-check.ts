import { strict as assert } from "node:assert";
import { mock } from "bun:test";

const secrets = new Map<string, string>();
const operations: string[] = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, string>) => {
    if (command === "community_extension_store") operations.push(args.operation);
    if (command === "load_secret") return secrets.get(args.account) ?? null;
    if (command === "store_secret") secrets.set(args.account, args.secret);
    if (command === "delete_secret") secrets.delete(args.account);
  },
}));

const { TauriExtensionStorage } = await import("../../src/lib/extensions/tauri-storage");

const storage = new TauriExtensionStorage();
await storage.secretSet("l8db.jev", "apiKey", "first-key");
await storage.secretSet("l8db.jev", "apiKey", "updated-key");
assert.equal(await storage.secretGet("l8db.jev", "apiKey"), "updated-key");
assert.deepEqual(JSON.parse(secrets.get("extension-secret-index:l8db.jev") ?? "[]"), ["apiKey"]);
await storage.secretDelete("l8db.jev", "apiKey");
assert.equal(await storage.secretGet("l8db.jev", "apiKey"), null);
await storage.secretSet("l8db.jev", "apiKey", "third-key");
await storage.remove("l8db.jev");
assert.equal(secrets.has("extension:l8db.jev:apiKey"), false);
assert.equal(secrets.has("extension-secret-index:l8db.jev"), false);
assert.deepEqual(operations, ["remove"]);

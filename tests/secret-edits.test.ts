import { beforeEach, expect, mock, test } from "bun:test";

const keychain = new Map<string, string>();

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: Record<string, string>) => {
    if (command === "load_secret") return keychain.get(args?.account ?? "") ?? null;
    if (command === "store_secret") keychain.set(args?.account ?? "", args?.secret ?? "");
    if (command === "delete_secret") keychain.delete(args?.account ?? "");
    return null;
  },
  transformCallback: () => 1,
}));

const { deleteSecret, rememberSecret, storeSecret } = await import("../src/lib/secrets");
const { readSecretEdits, recordSecretEdits, SECRET_EDITS_KEY } = await import(
  "../src/lib/secret-edits"
);

beforeEach(() => {
  keychain.clear();
  window.localStorage.removeItem(SECRET_EDITS_KEY);
  recordSecretEdits([]);
});

test("re-saving an unchanged password after a restart records no edit", async () => {
  keychain.set("conn-1", "pw");
  const before = readSecretEdits()["conn-1"];
  await storeSecret("conn-1", "pw");
  expect(readSecretEdits()["conn-1"]).toBe(before);
  await storeSecret("conn-1", "neu");
  expect(readSecretEdits()["conn-1"]).toBeNumber();
});

test("deleting a missing password records nothing, clearing a stored one records an edit", async () => {
  await deleteSecret("conn-2");
  expect(readSecretEdits()["conn-2"]).toBeUndefined();
  keychain.set("conn-3:ssh", "x");
  await deleteSecret("conn-3:ssh");
  expect(readSecretEdits()["conn-3:ssh"]).toBeNumber();
});

test("moving a password to the vault records an edit", async () => {
  keychain.set("conn-4", "x");
  await rememberSecret("conn-4", "x");
  expect(readSecretEdits()["conn-4"]).toBeNumber();
});

test("batched edits ignore non-connection accounts", () => {
  recordSecretEdits(["conn-5", "automation:smtp:x", "l8db-sync:github"], 42);
  const edits = readSecretEdits();
  expect(edits["conn-5"]).toBe(42);
  expect(Object.keys(edits)).not.toContain("automation:smtp:x");
});

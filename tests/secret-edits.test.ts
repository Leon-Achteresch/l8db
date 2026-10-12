import { beforeEach, expect, mock, test } from "bun:test";

const keychain = new Map<string, string>();
let loadGate: Promise<void> | null = null;

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: Record<string, string>) => {
    if (command === "load_secret") {
      const value = keychain.get(args?.account ?? "") ?? null;
      if (loadGate) await loadGate;
      return value;
    }
    if (command === "store_secret") keychain.set(args?.account ?? "", args?.secret ?? "");
    if (command === "delete_secret") keychain.delete(args?.account ?? "");
    return null;
  },
  transformCallback: () => 1,
}));

const { deleteSecret, forgetSessionSecret, loadSecret, peekSecret, rememberSecret, storeSecret } =
  await import("../src/lib/secrets");
const { readSecretEdits, recordSecretEdits, resetSecretEditCache, SECRET_EDITS_KEY } = await import(
  "../src/lib/secret-edits"
);

beforeEach(() => {
  keychain.clear();
  loadGate = null;
  window.localStorage.removeItem(SECRET_EDITS_KEY);
  resetSecretEditCache();
});

test("re-saving an unchanged password after a restart records no edit", async () => {
  keychain.set("conn-1", "pw");
  await storeSecret("conn-1", "pw");
  expect(readSecretEdits()["conn-1"]).toBeUndefined();
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

test("untracked accounts skip the extra keychain read and record nothing", async () => {
  await storeSecret("automation:smtp:x", "pw");
  expect(Object.keys(readSecretEdits())).toEqual([]);
});

test("two windows writing alternately never lose an edit", () => {
  recordSecretEdits(["conn-a"], 10);
  const other = JSON.parse(window.localStorage.getItem(SECRET_EDITS_KEY) ?? "{}");
  other["conn-b"] = 20;
  other["conn-a"] = 30;
  window.localStorage.setItem(SECRET_EDITS_KEY, JSON.stringify(other));
  recordSecretEdits(["conn-c"], 40);
  recordSecretEdits(["conn-a"], 15);
  const edits = JSON.parse(window.localStorage.getItem(SECRET_EDITS_KEY) ?? "{}");
  expect(edits).toEqual({ "conn-a": 30, "conn-b": 20, "conn-c": 40 });
});

test("a load that started before a store cannot overwrite the newer value", async () => {
  keychain.set("conn-5", "alt");
  forgetSessionSecret("conn-5");
  let open: () => void = () => undefined;
  loadGate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const loading = loadSecret("conn-5");
  loadGate = null;
  await storeSecret("conn-5", "neu");
  open();
  expect(await loading).toBe("neu");
  expect(peekSecret("conn-5")).toBe("neu");
});

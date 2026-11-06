import { expect, test } from "bun:test";

const storage = new Map<string, string>();
let listener: ((event: { key: string; newValue: string }) => void) | undefined;
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    addEventListener: (_type: string, callback: typeof listener) => {
      listener = callback;
    },
  },
});
const { useUiPluginSettings } = await import("../src/lib/ui-plugins/settings");

test("imported options and revoked grants reach another window through persisted settings", async () => {
  const serialized = JSON.stringify({
    version: 1,
    state: { disabled: [], installed: {}, options: { example: { limit: 7 } }, httpGrants: {} },
  });
  storage.set("l8db.ui-plugins", serialized);
  expect(listener).toBeDefined();
  listener?.({ key: "l8db.ui-plugins", newValue: serialized });
  await Promise.resolve();
  expect(useUiPluginSettings.getState().options.example).toEqual({ limit: 7 });
  expect(useUiPluginSettings.getState().httpGrants).toEqual({});
});

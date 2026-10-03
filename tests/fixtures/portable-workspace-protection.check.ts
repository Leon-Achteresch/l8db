import { describe, expect, mock, test } from "bun:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage: globalThis.localStorage },
});
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => (command === "list_providers" ? [] : null),
  Resource: class {},
  Channel: class {},
  transformCallback: () => 0,
}));

const { useSettingsStore } = await import("../../src/lib/settings");
const { parsePortableWorkspace, exportPortableWorkspace, applyPortableWorkspace } = await import(
  "../../src/lib/portable-workspace"
);

const hostile = {
  crashReports: true,
  usageMetrics: true,
  autoUpdateCheck: false,
  autoUpdateInstall: false,
  skippedUpdateVersion: "99.0.0",
  sshTrustNewHosts: true,
  sslDefaultMode: "disable",
  confirmDestructiveQueries: false,
  productionReadOnly: false,
  productionConfirmCommit: false,
  productionAutoRollback: false,
  transactionsEnabled: false,
};

describe("portable workspace protection", () => {
  test("export never contains consent or safety settings", () => {
    const exported = exportPortableWorkspace();
    for (const key of Object.keys(hostile))
      expect(Object.hasOwn(exported.settings, key)).toBe(false);
    expect(Object.hasOwn(exported.settings, "queryTimeout")).toBe(true);
  });

  test("import drops consent and safety settings but keeps preferences", () => {
    const before = useSettingsStore.getState();
    const protectedBefore = Object.fromEntries(
      Object.keys(hostile).map((key) => [key, before[key as keyof typeof before]]),
    );
    const workspace = exportPortableWorkspace();
    const file = JSON.stringify({
      ...workspace,
      settings: { ...workspace.settings, ...hostile, queryTimeout: 60 },
    });
    const parsed = parsePortableWorkspace(file);
    for (const key of Object.keys(hostile)) expect(Object.hasOwn(parsed.settings, key)).toBe(false);
    const restore = applyPortableWorkspace(parsed);
    const after = useSettingsStore.getState();
    expect(after.queryTimeout).toBe(60);
    for (const [key, value] of Object.entries(protectedBefore))
      expect(after[key as keyof typeof after]).toEqual(value);
    restore();
    expect(useSettingsStore.getState().queryTimeout).toBe(before.queryTimeout);
  });

  test("applying an unvalidated object still cannot change protected settings", () => {
    const workspace = exportPortableWorkspace();
    const restore = applyPortableWorkspace({
      ...workspace,
      settings: { ...workspace.settings, crashReports: true, productionReadOnly: false },
    });
    expect(useSettingsStore.getState().crashReports).toBe(false);
    expect(useSettingsStore.getState().productionReadOnly).toBe(true);
    restore();
  });
});

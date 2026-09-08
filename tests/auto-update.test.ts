import { beforeEach, describe, expect, test } from "bun:test";
import type { Update } from "@tauri-apps/plugin-updater";

const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
};
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});
Object.defineProperty(globalThis, "window", {
  value: { localStorage: localStorageMock },
  configurable: true,
});

const { useSettingsStore } = await import("../src/lib/settings");
const {
  closeUpdatePrompt,
  getPendingUpdate,
  getUpdatePromptState,
  presentUpdate,
  setPendingUpdate,
} = await import("../src/lib/updater");

beforeEach(() => {
  storage.clear();
  setPendingUpdate(null);
  useSettingsStore.setState({
    rowLimit: 100,
    editorFontSize: 13,
    queryTimeout: 30,
    sshTrustNewHosts: false,
    transactionsEnabled: true,
    autoUpdateCheck: true,
    autoUpdateInstall: false,
    skippedUpdateVersion: null,
  });
});

describe("auto-update settings", () => {
  test("defaults: automatische Prüfung an, automatische Installation aus", () => {
    const state = useSettingsStore.getState();
    expect(state.autoUpdateCheck).toBe(true);
    expect(state.autoUpdateInstall).toBe(false);
  });

  test("Deaktivieren der Prüfung schaltet die automatische Installation mit aus", () => {
    useSettingsStore.getState().setAutoUpdateInstall(true);
    expect(useSettingsStore.getState().autoUpdateInstall).toBe(true);
    useSettingsStore.getState().setAutoUpdateCheck(false);
    const state = useSettingsStore.getState();
    expect(state.autoUpdateCheck).toBe(false);
    expect(state.autoUpdateInstall).toBe(false);
  });

  test("Aktivieren der Prüfung lässt die Installationseinstellung unverändert", () => {
    useSettingsStore.getState().setAutoUpdateCheck(false);
    useSettingsStore.getState().setAutoUpdateCheck(true);
    expect(useSettingsStore.getState().autoUpdateInstall).toBe(false);
    useSettingsStore.getState().setAutoUpdateInstall(true);
    useSettingsStore.getState().setAutoUpdateCheck(true);
    expect(useSettingsStore.getState().autoUpdateInstall).toBe(true);
  });
});

describe("skipped update version", () => {
  test("startet leer und lässt sich setzen und wieder aufheben", () => {
    expect(useSettingsStore.getState().skippedUpdateVersion).toBeNull();
    useSettingsStore.getState().setSkippedUpdateVersion("0.2.1");
    expect(useSettingsStore.getState().skippedUpdateVersion).toBe("0.2.1");
    useSettingsStore.getState().setSkippedUpdateVersion(null);
    expect(useSettingsStore.getState().skippedUpdateVersion).toBeNull();
  });
});
describe("pending update cache", () => {
  test("startet leer und lässt sich setzen und wieder löschen", () => {
    expect(getPendingUpdate()).toBeNull();
    const fake = { version: "9.9.9" } as unknown as Update;
    setPendingUpdate(fake);
    expect(getPendingUpdate()?.version).toBe("9.9.9");
    setPendingUpdate(null);
    expect(getPendingUpdate()).toBeNull();
  });
});

describe("update prompt", () => {
  test("öffnet das Popup für ein gefundenes Update und schließt es wieder", () => {
    const fake = { version: "0.1.99" } as unknown as Update;
    presentUpdate(fake);
    expect(getUpdatePromptState()).toEqual({ update: fake, open: true });
    closeUpdatePrompt();
    expect(getUpdatePromptState()).toEqual({ update: fake, open: false });
    setPendingUpdate(null);
    expect(getUpdatePromptState()).toEqual({ update: null, open: false });
  });
});

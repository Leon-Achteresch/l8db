import { beforeEach, expect, test } from "bun:test";
import {
  clearUiPluginSafeMode,
  detectUiPluginSafeMode,
  markUiPluginLoading,
} from "../src/lib/ui-plugins/safe-mode";

const values = new Map<string, string>();
const storage = {
  get length() {
    return values.size;
  },
  key: (index: number) => [...values.keys()][index] ?? null,
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => void values.set(key, String(value)),
  removeItem: (key: string) => void values.delete(key),
  clear: () => values.clear(),
};
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

beforeEach(() => values.clear());

test("sauberer Start bleibt im Normalmodus", () => {
  expect(detectUiPluginSafeMode()).toBe(false);
  const done = markUiPluginLoading();
  done();
  expect(detectUiPluginSafeMode()).toBe(false);
  expect(values.size).toBe(0);
});

test("nicht abgeschlossenes Laden schaltet in den abgesicherten Modus", () => {
  markUiPluginLoading();
  expect(detectUiPluginSafeMode()).toBe(true);
  expect(detectUiPluginSafeMode()).toBe(true);
  clearUiPluginSafeMode();
  expect(detectUiPluginSafeMode()).toBe(false);
});

test("frisches Laden eines anderen Fensters löst nichts aus, ein veraltetes schon", () => {
  const now = Date.now();
  values.set("l8db.ui-plugins.loading:?window=1", String(now - 1_000));
  expect(detectUiPluginSafeMode(now)).toBe(false);
  values.set("l8db.ui-plugins.loading:?window=1", String(now - 120_000));
  expect(detectUiPluginSafeMode(now)).toBe(true);
});

test("kaputter Merker zählt als Hänger und wird entfernt", () => {
  values.set("l8db.ui-plugins.loading:?window=2", "kaputt");
  expect(detectUiPluginSafeMode()).toBe(true);
  expect(values.has("l8db.ui-plugins.loading:?window=2")).toBe(false);
});

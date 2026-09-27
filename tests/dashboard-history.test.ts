import { beforeEach, expect, test } from "bun:test";

const storage = new Map<string, string>();
if (typeof window === "undefined")
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

const {
  clearDashboardHistory,
  redoDashboards,
  undoDashboards,
  useDashboardsStore,
  withoutDashboardHistory,
} = await import("@/lib/dashboards");

const GROUP_PAUSE_MS = 450;
let id = "";

const current = () => useDashboardsStore.getState().dashboards.find((d) => d.id === id);
const past = () => useDashboardsStore.temporal.getState().pastStates.length;
const rename = (name: string) => useDashboardsStore.getState().update(id, { name });

beforeEach(async () => {
  useDashboardsStore.setState({ dashboards: [], active: {} });
  id = useDashboardsStore.getState().add("conn", null, "Start");
  await Bun.sleep(GROUP_PAUSE_MS);
  clearDashboardHistory();
});

test("undo und redo stellen Änderungen wieder her", async () => {
  rename("Eins");
  await Bun.sleep(GROUP_PAUSE_MS);
  rename("Zwei");
  expect(past()).toBe(2);
  undoDashboards();
  expect(current()?.name).toBe("Eins");
  redoDashboards();
  expect(current()?.name).toBe("Zwei");
});

test("schnelle Eingaben ergeben einen Undo-Schritt", () => {
  rename("a");
  rename("ab");
  rename("abc");
  expect(past()).toBe(1);
  undoDashboards();
  expect(current()?.name).toBe("Start");
});

test("Sperre und Refresh sind nicht Teil des Verlaufs", async () => {
  rename("Bearbeitet");
  await Bun.sleep(GROUP_PAUSE_MS);
  useDashboardsStore.getState().update(id, { locked: true, refreshSec: 60 });
  expect(past()).toBe(1);
  undoDashboards();
  expect(current()?.name).toBe("Start");
  expect(current()?.locked).toBe(true);
  expect(current()?.refreshSec).toBe(60);
});

test("externe Syncs landen nicht im Verlauf", async () => {
  rename("Lokal");
  await Bun.sleep(GROUP_PAUSE_MS);
  withoutDashboardHistory(() => rename("Aus Datei"));
  expect(past()).toBe(0);
  expect(current()?.name).toBe("Aus Datei");
});

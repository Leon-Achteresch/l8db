import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DEMO_DB_FILE,
  demoConnectionInput,
  demoDatabasePath,
} from "../src/lib/discovery/lessons/demo-db";
import { installModifierOverlay } from "../src/lib/discovery/modifier-overlay/install";
import { modifierKeyFor } from "../src/lib/discovery/modifier-overlay/modifier-state";
import { HOTKEY_COMMANDS } from "../src/lib/hotkeys/commands";
import { conflictKey } from "../src/lib/hotkeys/conflicts";

describe("demo database path", () => {
  test.each([
    [
      "windows app cache with spaces and umlauts",
      "C:\\Users\\Jürgen Müller\\AppData\\Local\\com.leon.l8db\\",
      `C:\\Users\\Jürgen Müller\\AppData\\Local\\com.leon.l8db\\${DEMO_DB_FILE}`,
    ],
    [
      "windows unc profile",
      "\\\\server\\profiles\\jürgen\\com.leon.l8db",
      `\\\\server\\profiles\\jürgen\\com.leon.l8db\\${DEMO_DB_FILE}`,
    ],
    [
      "linux xdg cache",
      "/home/jürgen müller/.cache/com.leon.l8db",
      `/home/jürgen müller/.cache/com.leon.l8db/${DEMO_DB_FILE}`,
    ],
    [
      "macos caches",
      "/Users/abc def/Library/Caches/com.leon.l8db/",
      `/Users/abc def/Library/Caches/com.leon.l8db/${DEMO_DB_FILE}`,
    ],
  ])("%s", (_name, directory, expected) => {
    expect(demoDatabasePath(directory)).toBe(expected);
  });

  test("the connection string is the raw path like file-open connections", () => {
    const path = `C:\\Users\\Jürgen Müller\\AppData\\Local\\com.leon.l8db\\${DEMO_DB_FILE}`;
    const input = demoConnectionInput(path);
    expect(input.kind).toBe("sqlite");
    expect(input.connectionString).toBe(path);
    const fileOpen = readFileSync(new URL("../src/lib/file-open.ts", import.meta.url), "utf8");
    expect(fileOpen).toContain("connectionString: action.path");
  });

  test("the demo file lives in the per-user app cache, not the shared temp dir", () => {
    const source = readFileSync(
      new URL("../src/lib/discovery/lessons/demo-db.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("appCacheDir");
    expect(source).not.toContain("tempDir");
  });
});

describe("discovery hotkeys on every platform", () => {
  const reserved = [
    "Mod+H",
    "Mod+F",
    "Mod+P",
    "Mod+R",
    "Mod+W",
    "Mod+Q",
    "Mod+Shift+I",
    "Mod+Shift+J",
    "F5",
    "F10",
    "F12",
    "Alt",
    "Alt+F4",
  ];
  for (const mac of [true, false]) {
    test(`${mac ? "macOS" : "Windows/Linux"}: help commands are unique and not reserved`, () => {
      const keys = new Map<string, string[]>();
      for (const command of HOTKEY_COMMANDS) {
        for (const hotkey of [command.defaultHotkey, ...(command.aliases ?? [])]) {
          const key = conflictKey(hotkey, mac);
          keys.set(key, [...(keys.get(key) ?? []), command.id]);
        }
      }
      const blocked = new Set(reserved.map((hotkey) => conflictKey(hotkey, mac)));
      for (const id of ["help.whatsThis", "help.cheatsheet"]) {
        const command = HOTKEY_COMMANDS.find((entry) => entry.id === id);
        expect(command).toBeDefined();
        const key = conflictKey(command?.defaultHotkey ?? "", mac);
        expect(keys.get(key)).toEqual([id]);
        expect(blocked.has(key)).toBe(false);
      }
    });
  }

  test("native menu entries carry no accelerator", () => {
    const desktop = readFileSync(new URL("../src-tauri/src/desktop.rs", import.meta.url), "utf8");
    for (const id of ["menu.discover", "help.whatsThis", "help.cheatsheet"]) {
      const line = desktop.split("\n").find((entry) => entry.includes(`"${id}"`)) ?? "";
      expect(line).toContain(".text(");
    }
  });
});

type Listener = (event: Event) => void;

function fakeTarget() {
  const target = new EventTarget() as EventTarget & { hidden: boolean; listeners: () => number };
  let count = 0;
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = (type: string, listener: Listener, options?: unknown) => {
    count++;
    add(type, listener, options as AddEventListenerOptions);
  };
  target.removeEventListener = (type: string, listener: Listener, options?: unknown) => {
    count--;
    remove(type, listener, options as EventListenerOptions);
  };
  target.hidden = false;
  target.listeners = () => count;
  return target;
}

function key(type: "keydown" | "keyup", init: Partial<KeyboardEvent> & { altGraph?: boolean }) {
  const event = new Event(type, { cancelable: true });
  return Object.assign(event, {
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...init,
    getModifierState: (name: string) => name === "AltGraph" && init.altGraph === true,
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function overlay(platform: "mac" | "windows" | "linux") {
  const target = fakeTarget();
  const doc = fakeTarget();
  const log: string[] = [];
  const modifier = modifierKeyFor(platform);
  const dispose = installModifierOverlay({
    modifier,
    holdMs: 5,
    target: target as unknown as Window,
    doc: doc as unknown as Document,
    onShow: () => log.push("show"),
    onHide: () => log.push("hide"),
  });
  const down = (extra: Partial<KeyboardEvent> & { altGraph?: boolean } = {}) => {
    const event = key("keydown", {
      key: modifier,
      ctrlKey: modifier === "Control",
      metaKey: modifier === "Meta",
      ...extra,
    });
    target.dispatchEvent(event);
    return event;
  };
  return { target, doc, log, dispose, down };
}

describe("modifier overlay cancellation", () => {
  test.each(["windows", "linux", "mac"] as const)(
    "%s: holding alone shows, release hides",
    async (platform) => {
      const { target, log, dispose, down } = overlay(platform);
      expect(down().defaultPrevented).toBe(false);
      await sleep(40);
      expect(log).toEqual(["show"]);
      target.dispatchEvent(key("keyup", { key: modifierKeyFor(platform) }));
      expect(log).toEqual(["show", "hide"]);
      dispose();
    },
  );

  test.each([
    ["ctrl+click", "pointerdown"],
    ["ctrl+mousedown", "mousedown"],
    ["ctrl+wheel zoom", "wheel"],
    ["scroll", "scroll"],
    ["window blur on Linux focus switch", "blur"],
  ])("%s hides the badges and key repeat does not bring them back", async (_name, type) => {
    const { target, log, dispose, down } = overlay("windows");
    down();
    await sleep(40);
    const event = new Event(type, { cancelable: true });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(log).toEqual(["show", "hide"]);
    down({ repeat: true });
    await sleep(40);
    expect(log).toEqual(["show", "hide"]);
    dispose();
  });

  test("cancel during the hold never shows", async () => {
    const { target, log, dispose, down } = overlay("linux");
    down();
    target.dispatchEvent(new Event("pointerdown"));
    await sleep(40);
    expect(log).toEqual([]);
    dispose();
  });

  test.each([
    ["Strg+C", { key: "c" }],
    ["Strg+Shift", { key: "Shift", shiftKey: true }],
    ["AltGr on Windows", { key: "AltGraph", altKey: true, altGraph: true }],
  ])("%s within the hold never shows", async (_name, extra) => {
    const { log, dispose, down } = overlay("windows");
    down();
    down(extra);
    await sleep(40);
    expect(log).toEqual([]);
    dispose();
  });

  test.each([
    ["Alt alone (Windows menu bar)", { key: "Alt", altKey: true, ctrlKey: false }],
    ["F10 (Windows menu bar)", { key: "F10", ctrlKey: false }],
    ["Meta on Windows/Linux", { key: "Meta", metaKey: true, ctrlKey: false }],
  ])("%s is ignored and not prevented", async (_name, extra) => {
    const { log, dispose, down } = overlay("windows");
    const event = down(extra);
    await sleep(40);
    expect(event.defaultPrevented).toBe(false);
    expect(log).toEqual([]);
    dispose();
  });

  test("hidden document hides and dispose removes every listener", async () => {
    const { target, doc, log, dispose, down } = overlay("windows");
    down();
    await sleep(40);
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(log).toEqual(["show", "hide"]);
    dispose();
    expect(target.listeners()).toBe(0);
    expect(doc.listeners()).toBe(0);
    down();
    await sleep(40);
    expect(log).toEqual(["show", "hide"]);
  });
});

interface FakeWindow extends EventTarget {
  localStorage: Storage;
}

const shared = new Map<string, string>();
const writes = new Map<string, number>();
const windows: FakeWindow[] = [];

function fakeWindow(): FakeWindow {
  const target = new EventTarget() as FakeWindow;
  const storage = {
    get length() {
      return shared.size;
    },
    key: (index: number) => [...shared.keys()][index] ?? null,
    getItem: (name: string) => shared.get(name) ?? null,
    setItem: (name: string, value: string) => {
      writes.set(name, (writes.get(name) ?? 0) + 1);
      if (shared.get(name) === value) return;
      shared.set(name, value);
      for (const other of windows) {
        if (other === target) continue;
        other.dispatchEvent(Object.assign(new Event("storage"), { key: name, newValue: value }));
      }
    },
    removeItem: (name: string) => void shared.delete(name),
    clear: () => shared.clear(),
  };
  target.localStorage = storage as unknown as Storage;
  windows.push(target);
  return target;
}

const originalWindow = globalThis.window;
async function loadIn(target: FakeWindow, tag: string) {
  Object.defineProperty(globalThis, "window", { value: target, configurable: true });
  return {
    hotspots: (await import(`../src/lib/discovery/hotspots/store.ts?${tag}`)).useHotspotStore,
    overlay: (await import(`../src/lib/discovery/modifier-overlay/settings.ts?${tag}`))
      .useModifierOverlayStore,
    spotlight: (await import(`../src/lib/discovery/spotlight/store.ts?${tag}`)).useSpotlightStore,
  };
}
const first = await loadIn(fakeWindow(), "platform-a");
const second = await loadIn(fakeWindow(), "platform-b");
Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });

afterAll(() => {
  Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
});

describe("discovery stores across windows", () => {
  test("a dismissed hotspot reaches the other window with exactly one write", () => {
    writes.clear();
    first.hotspots.getState().dismiss("discover.atlas");
    expect(second.hotspots.getState().dismissed).toEqual(["discover.atlas"]);
    expect(writes.get("l8db.discovery.hotspots")).toBe(1);
    second.hotspots.getState().dismiss("discover.lessons");
    expect(first.hotspots.getState().dismissed).toEqual(["discover.atlas", "discover.lessons"]);
    expect(writes.get("l8db.discovery.hotspots")).toBe(2);
  });

  test("the modifier overlay switch syncs without ping-pong", () => {
    writes.clear();
    first.overlay.getState().setEnabled(false);
    expect(second.overlay.getState().enabled).toBe(false);
    second.overlay.getState().setEnabled(true);
    expect(first.overlay.getState().enabled).toBe(true);
    expect(writes.get("l8db.discovery.modifier-overlay")).toBe(2);
  });

  test("spotlight activity syncs and rehydration never writes back", () => {
    writes.clear();
    const now = Date.UTC(2026, 10, 8, 12);
    first.spotlight.getState().touch(now);
    expect(second.spotlight.getState().lastActive).toBe(now);
    const after = writes.get("l8db.discovery.spotlight") ?? 0;
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(2);
    second.spotlight.persist.rehydrate();
    first.spotlight.persist.rehydrate();
    expect(writes.get("l8db.discovery.spotlight")).toBe(after);
  });
});

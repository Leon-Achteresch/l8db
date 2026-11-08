import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { el, fakeTarget } from "./discovery-help-dom";

mock.module("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

const host = window as unknown as Record<string, unknown>;
if (typeof host.addEventListener !== "function")
  Object.assign(host, { addEventListener() {}, removeEventListener() {} });
if (!("localStorage" in globalThis))
  Object.defineProperty(globalThis, "localStorage", {
    value: host.localStorage,
    configurable: true,
  });

const { blockingOverlayOpen, createVideoTooltipController, installVideoTooltips } = await import(
  "../src/lib/discovery/video-tooltips/controller"
);
const { getActiveSurface, resetCoordinatorSession, useCoordinatorStore } = await import(
  "../src/lib/discovery/coordinator"
);
const { installPromoter } = await import("../src/lib/discovery/promoter/controller");
const { PROMOTER_STORAGE_KEY, usePromoterStore } = await import(
  "../src/lib/discovery/promoter/store"
);
const { installFeedback } = await import("../src/lib/discovery/feedback/controller");
const { FEEDBACK_STORAGE_KEY, useFeedbackStore } = await import(
  "../src/lib/discovery/feedback/store"
);
const { installRelated } = await import("../src/lib/discovery/related/controller");
const { RELATED_STORAGE_KEY, useRelatedStore } = await import("../src/lib/discovery/related/store");
const { installWaitTips, useWaitTipsSeenStore, WAIT_TIPS_STORAGE_KEY } = await import(
  "../src/lib/discovery/wait-tips/controller"
);
const { commitWaitTip, useWaitTipStore } = await import("../src/lib/discovery/wait-tips/current");
const { MODIFIER_OVERLAY_KEY, useModifierOverlayStore } = await import(
  "../src/lib/discovery/modifier-overlay/settings"
);
const { modifierKeyFor } = await import("../src/lib/discovery/modifier-overlay/modifier-state");
const { recordFeatureEvent } = await import("../src/lib/discovery/events");
const { recordFeatureUse, resetDiscoveryProgress, useFeatureUsageStore } = await import(
  "../src/lib/discovery/usage"
);
const { featureById } = await import("../src/lib/discovery/catalog");
const { detectHotkeyPlatform } = await import("../src/lib/hotkeys/display");
const { buildFeatureItems } = await import("../src/features/shell/app-header-search/command-items");
const { POSTGRES_CAPABILITIES } = await import("../src/lib/providers");

import type { DiscoveryChannel } from "../src/lib/discovery/channels";

const PG = POSTGRES_CAPABILITIES;
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

afterAll(() => {
  if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
});

beforeEach(() => {
  resetDiscoveryProgress();
  resetCoordinatorSession();
  usePromoterStore.setState({ stats: {}, active: null });
  useFeedbackStore.setState({ asked: [], answers: [], active: null });
  useRelatedStore.setState({ shown: [], active: null });
  useWaitTipsSeenStore.setState({ seen: [] });
  useWaitTipStore.setState({ tip: null, commit: null });
});

function visible<T extends object>(node: T): T {
  return Object.assign(node, { getClientRects: () => [{}] });
}

function occupy(channel: DiscoveryChannel, id = "x") {
  useCoordinatorStore.setState({
    active: { channel, id, priority: 1, explicit: false, since: 0 },
  });
}

describe("Video-Tooltips neben Radix-Tooltips", () => {
  test("offener Radix-Tooltip blockiert nicht, Menüs und Dialoge schon", () => {
    const tooltip = visible(
      el("div", { "data-radix-popper-content-wrapper": "" }, [
        el("div", { "data-slot": "tooltip-content" }, [el("span", { role: "tooltip" })]),
      ]),
    );
    expect(blockingOverlayOpen(el("body", {}, [tooltip]) as unknown as ParentNode)).toBe(false);
    const menu = visible(
      el("div", { "data-radix-popper-content-wrapper": "" }, [el("div", { role: "menu" })]),
    );
    expect(blockingOverlayOpen(el("body", {}, [menu]) as unknown as ParentNode)).toBe(true);
    const dialog = visible(el("div", { role: "dialog" }));
    expect(blockingOverlayOpen(el("body", {}, [tooltip, dialog]) as unknown as ParentNode)).toBe(
      true,
    );
    const hidden = Object.assign(el("div", { role: "dialog" }), { getClientRects: () => [] });
    expect(blockingOverlayOpen(el("body", {}, [hidden]) as unknown as ParentNode)).toBe(false);
  });

  test("Fensterwechsel während gedrückter Maus sperrt Tooltips nicht dauerhaft", async () => {
    const changes: (string | null)[] = [];
    const controller = createVideoTooltipController({
      hasClip: () => true,
      blocked: () => false,
      onChange: (target) => changes.push(target?.id ?? null),
      delay: 10,
    });
    const root = fakeTarget();
    const win = fakeTarget();
    const stop = installVideoTooltips(
      controller,
      root as unknown as Document,
      win as unknown as Window,
    );
    root.emit("pointerdown");
    win.emit("blur");
    controller.enter(el("button", { "data-feature": "a" }) as unknown as Element);
    await Bun.sleep(30);
    expect(changes).toEqual(["a"]);
    stop();
    expect(root.count() + win.count()).toBe(0);
  });
});

describe("Koordinator-Slot beim Abbau", () => {
  const installs: [DiscoveryChannel, () => () => void][] = [
    ["promoter", () => installPromoter(() => ({ capabilities: PG, easyMode: false }))],
    ["feedback", () => installFeedback()],
    ["related", () => installRelated(() => ({ capabilities: PG, easyMode: false }))],
  ];

  for (const [channel, install] of installs)
    test(`${channel} gibt die eigene Fläche frei`, () => {
      occupy(channel);
      install()();
      expect(getActiveSurface()).toBeNull();
    });

  test("fremde Flächen bleiben", () => {
    occupy("hotspots");
    for (const [, install] of installs) install()();
    expect(getActiveSurface()?.channel).toBe("hotspots");
  });
});

describe("Passt dazu", () => {
  test("bereits genutztes Ziel verbraucht keinen Slot", async () => {
    let attempts = 0;
    const stop = installRelated(() => ({ capabilities: PG, easyMode: false }), {
      intervalMs: 5,
      attempt: () => {
        attempts++;
        return "wait";
      },
    });
    useFeatureUsageStore.setState({ usage: {}, extra: 0 });
    recordFeatureUse("explain");
    expect(attempts).toBe(1);
    const { usage } = useFeatureUsageStore.getState();
    useFeatureUsageStore.setState({
      usage: { ...usage, "index-advisor": { count: 1, first: 1, last: 1 } },
    });
    const after = attempts;
    await Bun.sleep(30);
    stop();
    expect(attempts).toBe(after);
    expect(useRelatedStore.getState().active).toBeNull();
    expect(useCoordinatorStore.getState().autoCount).toBe(0);
  });
});

describe("Wartetipps", () => {
  const filter = (family: string | null) => ({
    family,
    capabilities: PG,
    easyMode: false,
    usage: {},
  });

  test("nur angezeigte Tipps gelten als gesehen", async () => {
    const stop = installWaitTips({ delayMs: 5, enabled: () => true, resolve: filter });
    recordFeatureEvent("query.started", { id: "w1", family: "postgres" });
    await Bun.sleep(20);
    const first = useWaitTipStore.getState().tip?.id;
    expect(first).toBeDefined();
    expect(useWaitTipsSeenStore.getState().seen).toEqual([]);
    recordFeatureEvent("query.finished", { id: "w1", ok: true });
    commitWaitTip();
    expect(useWaitTipsSeenStore.getState().seen).toEqual([]);
    recordFeatureEvent("query.started", { id: "w2", family: "postgres" });
    await Bun.sleep(20);
    expect(useWaitTipStore.getState().tip?.id).toBe(first as string);
    commitWaitTip();
    commitWaitTip();
    expect(useWaitTipsSeenStore.getState().seen).toEqual([first as string]);
    recordFeatureEvent("query.finished", { id: "w2", ok: true });
    stop();
  });
});

describe("Persistenz mit kaputtem oder altem JSON", () => {
  test("alle Stores fallen auf Standardwerte zurück", async () => {
    const raw: [string, string][] = [
      [PROMOTER_STORAGE_KEY, "{kaputt"],
      [FEEDBACK_STORAGE_KEY, JSON.stringify({ state: { asked: "x", answers: [{ vote: 1 }] } })],
      [RELATED_STORAGE_KEY, JSON.stringify({ state: { shown: [1, "a>b", null] }, version: 1 })],
      [WAIT_TIPS_STORAGE_KEY, JSON.stringify({ state: null, version: 1 })],
      [MODIFIER_OVERLAY_KEY, JSON.stringify({ state: { enabled: "nein" }, version: 1 })],
    ];
    for (const [key, value] of raw) localStorage.setItem(key, value);
    await Promise.all([
      usePromoterStore.persist.rehydrate(),
      useFeedbackStore.persist.rehydrate(),
      useRelatedStore.persist.rehydrate(),
      useWaitTipsSeenStore.persist.rehydrate(),
      useModifierOverlayStore.persist.rehydrate(),
    ]);
    expect(usePromoterStore.getState().stats).toEqual({});
    expect(useFeedbackStore.getState().asked).toEqual([]);
    expect(useFeedbackStore.getState().answers).toEqual([]);
    expect(useRelatedStore.getState().shown).toEqual(["a>b"]);
    expect(useWaitTipsSeenStore.getState().seen).toEqual([]);
    expect(useModifierOverlayStore.getState().enabled).toBe(true);
    for (const [key] of raw) localStorage.removeItem(key);
  });
});

describe("Plattformen", () => {
  const cases: [string, string, "mac" | "windows" | "linux", "Meta" | "Control"][] = [
    ["MacIntel", "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15", "mac", "Meta"],
    ["Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/130.0", "windows", "Control"],
    ["Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15", "linux", "Control"],
    ["", "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/605.1.15", "linux", "Control"],
  ];
  for (const [platform, userAgent, expected, modifier] of cases)
    test(`${expected}: ${platform || "leer"} → ${modifier}`, () => {
      Object.defineProperty(globalThis, "navigator", {
        value: { platform, userAgent },
        configurable: true,
      });
      expect(detectHotkeyPlatform()).toBe(expected);
      expect(modifierKeyFor(detectHotkeyPlatform())).toBe(modifier);
    });
});

describe("Palette-Vorschau", () => {
  test("Feature-Einträge tragen die videoId des Katalogs", () => {
    const items = buildFeatureItems("schema vergleichen", false, {}, () => {});
    expect(items.length).toBeGreaterThan(0);
    for (const item of items)
      expect(item.videoId).toBe(featureById(item.id.slice("feature:".length))?.videoId);
  });
});

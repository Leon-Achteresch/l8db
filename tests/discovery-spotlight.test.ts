import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

const host = window as unknown as Record<string, unknown>;
const restore: (() => void)[] = [];
if (typeof host.addEventListener !== "function") {
  Object.assign(host, { addEventListener() {}, removeEventListener() {} });
  restore.push(() => {
    delete host.addEventListener;
    delete host.removeEventListener;
  });
}
if (!("localStorage" in globalThis))
  Object.defineProperty(globalThis, "localStorage", {
    value: host.localStorage,
    configurable: true,
  });

const { AWAY_MS, decideSpotlight, featuresBetween, manualSpotlightContent, minorLabel } =
  await import("../src/lib/discovery/spotlight/model");
const { sameDay, useSpotlightStore } = await import("../src/lib/discovery/spotlight/store");
const { hotspotCandidates, selectHotspot } = await import("../src/lib/discovery/hotspots/model");
const { MAX_DISMISSED_HOTSPOTS, pruneDismissed, useHotspotStore } = await import(
  "../src/lib/discovery/hotspots/store"
);
const { createVideoTooltipController, installVideoTooltips } = await import(
  "../src/lib/discovery/video-tooltips/controller"
);
const { pickSource, releaseVideo, resolveClip } = await import(
  "../src/lib/discovery/video-tooltips/media"
);

import type { FeatureEntry } from "../src/lib/discovery/types";
import type { FeatureVideoFeed } from "../src/lib/feature-videos/model";

afterAll(() => {
  for (const undo of restore) undo();
});

function entry(
  id: string,
  since: string,
  size?: "major" | "minor",
  extra: Partial<FeatureEntry> = {},
) {
  return {
    id,
    title: `Titel ${id}`,
    summary: `Kurz ${id}`,
    area: "SQL-Editor",
    keywords: [],
    since,
    size,
    ...extra,
  } as FeatureEntry;
}

const ENTRIES: FeatureEntry[] = [
  entry("a", "0.18.0", "major"),
  entry("b", "0.18.0", "major", { area: "Dashboards" }),
  entry("c", "0.18.1", "major"),
  entry("d", "0.18.0", "major"),
  entry("e", "0.18.0", "minor"),
  entry("f", "0.16.0", "major"),
  entry("g", "0.16.0", undefined, { area: "Automatisierung" }),
  entry("h", "0.15.0", "major"),
  entry("i", "0.19.0", "major"),
];

const NOW = Date.UTC(2026, 10, 8, 12);
const base = {
  current: "0.18.1",
  seen: "0.17.4",
  lastActive: NOW - 1000,
  now: NOW,
  onboardingDone: true,
  entries: ENTRIES,
};

describe("Spotlight-Versionen", () => {
  test("Erstinstallation merkt nur die Version", () => {
    expect(
      decideSpotlight({ ...base, seen: null, lastActive: null, onboardingDone: false }),
    ).toEqual({ action: "remember", version: "0.18.1" });
  });

  test("bestehende Installation ohne gespeicherten Stand zeigt die aktuelle Minor", () => {
    const decision = decideSpotlight({ ...base, seen: null });
    expect(decision.action).toBe("show");
    if (decision.action === "show") expect(decision.content.kind).toBe("spotlight");
  });

  test("Patch-Update zeigt nichts", () => {
    expect(decideSpotlight({ ...base, current: "0.18.1", seen: "0.18.0" })).toEqual({
      action: "remember",
      version: "0.18.1",
    });
    expect(decideSpotlight({ ...base, current: "0.18.1", seen: "0.18.1" })).toEqual({
      action: "none",
    });
  });

  test("Minor-Update zeigt bis zu drei große Features der neuen Version", () => {
    const decision = decideSpotlight(base);
    expect(decision.action).toBe("show");
    if (decision.action !== "show") return;
    expect(decision.content.kind).toBe("spotlight");
    expect(decision.content.label).toBe("0.18");
    expect(decision.content.major.map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(decision.content.others).toEqual([]);
  });

  test("Minor-Update ohne große Features merkt nur die Version", () => {
    const decision = decideSpotlight({ ...base, entries: [entry("e", "0.18.0", "minor")] });
    expect(decision).toEqual({ action: "remember", version: "0.18.1" });
  });

  test("übersprungene Versionen ergeben Willkommen zurück mit Bereichsliste", () => {
    const decision = decideSpotlight({ ...base, seen: "0.15.2" });
    expect(decision.action).toBe("show");
    if (decision.action !== "show") return;
    expect(decision.content.kind).toBe("welcomeBack");
    expect(decision.content.label).toBe("0.15");
    expect(decision.content.major.map((item) => item.id)).toEqual(["c", "a", "b", "d", "f"]);
    expect(decision.content.others).toEqual([
      { area: "SQL-Editor", entries: [ENTRIES[4]] },
      { area: "Automatisierung", entries: [ENTRIES[6]] },
    ]);
  });

  test("21-Tage-Grenze ist exklusiv", () => {
    const exact = decideSpotlight({ ...base, lastActive: NOW - AWAY_MS });
    const later = decideSpotlight({ ...base, lastActive: NOW - AWAY_MS - 1 });
    expect(exact.action === "show" && exact.content.kind).toBe("spotlight");
    expect(later.action === "show" && later.content.kind).toBe("welcomeBack");
  });

  test("Pre-Release, Dev-Build und ungültige Version zeigen nichts automatisch", () => {
    expect(decideSpotlight({ ...base, current: "0.18.1-canary.3" })).toEqual({ action: "none" });
    expect(decideSpotlight({ ...base, dev: true })).toEqual({ action: "none" });
    expect(decideSpotlight({ ...base, current: null })).toEqual({ action: "none" });
    expect(decideSpotlight({ ...base, current: "kaputt" })).toEqual({ action: "none" });
  });

  test("nie beide in derselben Sitzung", () => {
    expect(decideSpotlight({ ...base, sessionShown: true })).toEqual({ action: "none" });
    expect(decideSpotlight({ ...base, seen: "0.15.0", sessionShown: true })).toEqual({
      action: "none",
    });
  });

  test("Downgrade merkt die Version ohne Dialog", () => {
    expect(decideSpotlight({ ...base, current: "0.17.0", seen: "0.18.0" })).toEqual({
      action: "remember",
      version: "0.17.0",
    });
  });

  test("Hilfsfunktionen", () => {
    expect(minorLabel("1.2.3")).toBe("1.2");
    expect(featuresBetween(ENTRIES, "0.18.0", "0.18.1").map((item) => item.id)).toEqual(["c"]);
    const manual = manualSpotlightContent(ENTRIES);
    expect(manual?.label).toBe("0.19");
    expect(manual?.major.map((item) => item.id)).toEqual(["i"]);
    expect(manualSpotlightContent([entry("x", "0.1.0")])).toBeNull();
  });
});

describe("Spotlight-Store", () => {
  beforeEach(() =>
    useSpotlightStore.setState({
      seenVersion: null,
      lastActive: null,
      sessionShown: false,
      open: null,
    }),
  );

  test("letzte Nutzung wird höchstens einmal pro Tag geschrieben", () => {
    const day = new Date(2026, 10, 8, 9).getTime();
    useSpotlightStore.getState().touch(day);
    useSpotlightStore.getState().touch(day + 3 * 3_600_000);
    expect(useSpotlightStore.getState().lastActive).toBe(day);
    useSpotlightStore.getState().touch(day + 86_400_000);
    expect(useSpotlightStore.getState().lastActive).toBe(day + 86_400_000);
    expect(sameDay(day, day + 1000)).toBe(true);
  });

  test("automatisches Anzeigen sperrt die Sitzung, manuelles nicht", () => {
    const content = { kind: "spotlight" as const, label: "0.18", major: [], others: [] };
    useSpotlightStore.getState().show(content, true);
    expect(useSpotlightStore.getState().sessionShown).toBe(false);
    useSpotlightStore.getState().show(content, false);
    expect(useSpotlightStore.getState().sessionShown).toBe(true);
    useSpotlightStore.getState().close();
    expect(useSpotlightStore.getState().open).toBeNull();
  });
});

describe("Hotspots", () => {
  const filter = { usage: {}, dismissed: [], version: "0.18.2", easyMode: false };

  test("nur große Features der aktuellen und vorigen Minor", () => {
    const list = [...ENTRIES, entry("p", "0.17.0", "major"), entry("q", "1.18.0", "major")];
    expect(hotspotCandidates(list, filter).map((item) => item.id)).toEqual([
      "c",
      "a",
      "b",
      "d",
      "p",
    ]);
    expect(hotspotCandidates(list, { ...filter, version: null })).toEqual([]);
  });

  test("genutzt, ausgeblendet und Easy Mode", () => {
    const list = [
      entry("a", "0.18.0", "major"),
      entry("b", "0.18.0", "major", { hiddenInEasyMode: true }),
      entry("c", "0.18.0", "major"),
    ];
    expect(
      hotspotCandidates(list, { ...filter, usage: { a: { count: 1 } }, dismissed: ["c"] }).map(
        (item) => item.id,
      ),
    ).toEqual(["b"]);
    expect(hotspotCandidates(list, { ...filter, easyMode: true }).map((item) => item.id)).toEqual([
      "a",
      "c",
    ]);
  });

  test("höchstens einer: erster Kandidat mit sichtbarem Anker", () => {
    const list = hotspotCandidates(ENTRIES, filter);
    const visible = new Set(["b", "d"]);
    const picked = selectHotspot(list, (item) => (visible.has(item.id) ? { id: item.id } : null));
    expect(picked?.entry.id).toBe("b");
    expect(selectHotspot(list, () => null)).toBeNull();
  });

  test("Ausblenden bleibt begrenzt", () => {
    useHotspotStore.setState({ dismissed: [] });
    useHotspotStore.getState().dismiss("a");
    useHotspotStore.getState().dismiss("a");
    expect(useHotspotStore.getState().dismissed).toEqual(["a"]);
    const many = Array.from({ length: 500 }, (_, index) => `f${index}`);
    expect(pruneDismissed([...many, 3, "<bad>"]).length).toBe(MAX_DISMISSED_HOTSPOTS);
    expect(pruneDismissed("x")).toEqual([]);
  });
});

function anchor(id: string) {
  return {
    isConnected: true,
    getAttribute: (name: string) => (name === "data-feature" ? id : null),
    closest() {
      return this;
    },
  } as unknown as Element;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Video-Tooltips", () => {
  function setup(blocked = false) {
    const changes: (string | null)[] = [];
    const controller = createVideoTooltipController({
      hasClip: (id) => id !== "ohne",
      blocked: () => blocked,
      onChange: (target) => changes.push(target?.id ?? null),
      delay: 30,
    });
    return { controller, changes };
  }

  test("erscheint erst nach der Verzögerung", async () => {
    const { controller, changes } = setup();
    controller.enter(anchor("a"));
    await wait(10);
    expect(changes).toEqual([]);
    await wait(40);
    expect(changes).toEqual(["a"]);
    controller.hide();
    expect(changes).toEqual(["a", null]);
  });

  test("Mausverlassen bricht ab, Features ohne Clip zeigen nichts", async () => {
    const { controller, changes } = setup();
    controller.enter(anchor("a"));
    controller.hide();
    controller.enter(anchor("ohne"));
    await wait(50);
    expect(changes).toEqual([]);
    expect(controller.pending()).toBeNull();
  });

  test("gedrückte Maustaste und offene Overlays blockieren", async () => {
    const pressed = setup();
    pressed.controller.press();
    pressed.controller.enter(anchor("a"));
    await wait(50);
    expect(pressed.changes).toEqual([]);
    pressed.controller.release();
    pressed.controller.enter(anchor("b"));
    pressed.controller.press();
    await wait(50);
    expect(pressed.changes).toEqual([]);
    const blocked = setup(true);
    blocked.controller.enter(anchor("a"));
    await wait(50);
    expect(blocked.changes).toEqual([]);
  });

  test("ein Ziel zur Zeit, Wechsel ersetzt", async () => {
    const { controller, changes } = setup();
    controller.enter(anchor("a"));
    await wait(50);
    controller.enter(anchor("b"));
    await wait(50);
    expect(changes).toEqual(["a", null, "b"]);
    expect(controller.shown()?.id).toBe("b");
  });

  test("delegierte Listener werden vollständig entfernt", () => {
    const listeners = new Map<string, number>();
    const target = {
      addEventListener: (type: string) => listeners.set(type, (listeners.get(type) ?? 0) + 1),
      removeEventListener: (type: string) => listeners.set(type, (listeners.get(type) ?? 0) - 1),
    };
    const { controller } = setup();
    const stop = installVideoTooltips(
      controller,
      target as unknown as Document,
      target as unknown as Window,
    );
    expect([...listeners.values()].every((count) => count === 1)).toBe(true);
    stop();
    expect([...listeners.values()].every((count) => count === 0)).toBe(true);
  });

  test("Medien: Format-Auswahl, reduzierte Bewegung, Freigabe", () => {
    const feed = {
      items: [
        {
          id: "clip",
          poster: "p.jpg",
          sources: [
            { url: "c.webm", type: "video/webm", bytes: 1 },
            { url: "c.mp4", type: "video/mp4", bytes: 1 },
          ],
        },
      ],
    } as unknown as FeatureVideoFeed;
    const clip = resolveClip("clip", feed, false);
    expect(pickSource(clip?.sources ?? [], (type) => type === "video/mp4")?.url).toBe("c.mp4");
    expect(resolveClip("clip", feed, true)?.sources).toEqual([]);
    expect(resolveClip("clip", null, false)).toBeNull();
    expect(resolveClip("fehlt", feed, false)).toBeNull();
    const calls: string[] = [];
    releaseVideo({
      pause: () => calls.push("pause"),
      removeAttribute: (name: string) => calls.push(`remove:${name}`),
      load: () => calls.push("load"),
    } as unknown as HTMLVideoElement);
    expect(calls).toEqual(["pause", "remove:src", "load"]);
  });
});

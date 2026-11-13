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

const { refreshSeenVersion, SPOTLIGHT_STORAGE_KEY, useSpotlightStore } = await import(
  "../src/lib/discovery/spotlight/store"
);
const { activeTeamTips, parseTeamTips, teamTipEnd } = await import("../src/lib/team/tips");

afterAll(() => {
  for (const undo of restore) undo();
});

describe("Spotlight über Sitzungen und Fenster", () => {
  beforeEach(() => {
    localStorage.removeItem(SPOTLIGHT_STORAGE_KEY);
    useSpotlightStore.setState({
      seenVersion: null,
      lastActive: null,
      previousActive: undefined,
      sessionShown: false,
      open: null,
    });
  });

  test("die letzte Nutzung vor dem Start bleibt bei erneutem Mount erhalten", () => {
    const away = new Date(2026, 9, 1, 9).getTime();
    const today = new Date(2026, 10, 8, 9).getTime();
    useSpotlightStore.setState({ lastActive: away });
    useSpotlightStore.getState().touch(today);
    expect(useSpotlightStore.getState().lastActive).toBe(today);
    useSpotlightStore.getState().touch(today + 1000);
    expect(useSpotlightStore.getState().previousActive).toBe(away);
  });

  test("ein anderes Fenster hat die Version schon gezeigt, ohne Storage-Ereignis", () => {
    useSpotlightStore.getState().markSeen("0.17.0");
    localStorage.setItem(
      SPOTLIGHT_STORAGE_KEY,
      JSON.stringify({ state: { seenVersion: "0.18.0", lastActive: 5 }, version: 1 }),
    );
    expect(useSpotlightStore.getState().seenVersion).toBe("0.17.0");
    expect(refreshSeenVersion()).toBe("0.18.0");
    expect(useSpotlightStore.getState().previousActive).toBeUndefined();
  });

  test("kaputter Speicher setzt nichts außer Kraft", () => {
    localStorage.setItem(SPOTLIGHT_STORAGE_KEY, "{kaputt");
    expect(refreshSeenVersion()).toBeNull();
    localStorage.setItem(
      SPOTLIGHT_STORAGE_KEY,
      JSON.stringify({ state: { seenVersion: "keine-version", lastActive: "gestern" } }),
    );
    expect(refreshSeenVersion()).toBeNull();
    expect(useSpotlightStore.getState().lastActive).toBeNull();
  });
});

describe("Team-Tipps: Datum", () => {
  test("ungültige Kalenderdaten werden verworfen statt übergerollt", () => {
    expect(Number.isNaN(teamTipEnd("2026-02-31"))).toBe(true);
    expect(Number.isNaN(teamTipEnd("2026-13-01"))).toBe(true);
    expect(Number.isNaN(teamTipEnd("0050-01-01"))).toBe(true);
    expect(teamTipEnd("2028-02-29")).toBe(new Date(2028, 2, 1).getTime());
    const tips = parseTeamTips([
      { id: "kaputt", title: "T", body: "B", until: "2026-02-31" },
      { id: "gut", title: "T", body: "B", until: "2026-02-28" },
    ]);
    expect(tips.map((tip) => tip.id)).toEqual(["gut"]);
  });

  test("until gilt bis Mitternacht lokaler Zeit, auch am Tag der Zeitumstellung", () => {
    const tips = [{ id: "a", title: "T", body: "B", until: "2026-03-29" }];
    expect(activeTeamTips(tips, new Date(2026, 2, 29, 23, 59, 59).getTime())).toHaveLength(1);
    expect(activeTeamTips(tips, new Date(2026, 2, 30, 0, 0, 0).getTime())).toHaveLength(0);
    const autumn = [{ id: "b", title: "T", body: "B", until: "2026-10-25" }];
    expect(activeTeamTips(autumn, new Date(2026, 9, 25, 23, 30).getTime())).toHaveLength(1);
    expect(activeTeamTips(autumn, new Date(2026, 9, 26, 0, 0).getTime())).toHaveLength(0);
  });
});

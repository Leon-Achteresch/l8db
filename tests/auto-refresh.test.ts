import { describe, expect, test } from "bun:test";

import {
  AUTO_REFRESH_INTERVALS,
  type AutoRefreshConditions,
  autoRefreshPauseReason,
  describeAutoRefreshInterval,
  isAutoRefreshInterval,
  normalizeAutoRefreshInterval,
  shouldAutoRefresh,
} from "../src/lib/auto-refresh";

const base: AutoRefreshConditions = {
  intervalMs: 5000,
  isTabVisible: true,
  isWindowVisible: true,
  isEditing: false,
  isSaving: false,
  isFetching: false,
  hasOpenTransaction: false,
};

describe("Intervalle", () => {
  test("bietet aus, 5s, 15s und 30s an", () => {
    expect([...AUTO_REFRESH_INTERVALS]).toEqual([0, 5000, 15000, 30000]);
    expect(isAutoRefreshInterval(15000)).toBe(true);
    expect(isAutoRefreshInterval(1000)).toBe(false);
  });

  test("normalisiert unbekannte Werte auf aus", () => {
    expect(normalizeAutoRefreshInterval(30000)).toBe(30000);
    expect(normalizeAutoRefreshInterval("5000")).toBe(5000);
    expect(normalizeAutoRefreshInterval(1234)).toBe(0);
    expect(normalizeAutoRefreshInterval(undefined)).toBe(0);
  });

  test("beschreibt Intervalle", () => {
    expect(describeAutoRefreshInterval(0)).toBe("Aus");
    expect(describeAutoRefreshInterval(15000)).toBe("15s");
  });
});

describe("shouldAutoRefresh", () => {
  test("ist standardmäßig aus", () => {
    expect(shouldAutoRefresh({ ...base, intervalMs: 0 })).toBe(false);
    expect(autoRefreshPauseReason({ ...base, intervalMs: 0 })).toBeNull();
  });

  test("aktualisiert bei sichtbarem Tab ohne Bearbeitung", () => {
    expect(shouldAutoRefresh(base)).toBe(true);
    expect(autoRefreshPauseReason(base)).toBeNull();
  });

  test("pausiert im Hintergrund oder unsichtbaren Tab", () => {
    expect(shouldAutoRefresh({ ...base, isWindowVisible: false })).toBe(false);
    expect(autoRefreshPauseReason({ ...base, isWindowVisible: false })).toBe(
      "Fenster im Hintergrund",
    );
    expect(autoRefreshPauseReason({ ...base, isTabVisible: false })).toBe("Tab nicht sichtbar");
  });

  test("pausiert bei Bearbeitung, Speichern und laufender Abfrage", () => {
    expect(autoRefreshPauseReason({ ...base, isEditing: true })).toBe("Bearbeitung offen");
    expect(autoRefreshPauseReason({ ...base, isSaving: true })).toBe("Speichern läuft");
    expect(autoRefreshPauseReason({ ...base, isFetching: true })).toBe("Abfrage läuft");
  });

  test("pausiert bei offener Transaktion", () => {
    expect(shouldAutoRefresh({ ...base, hasOpenTransaction: true })).toBe(false);
    expect(autoRefreshPauseReason({ ...base, hasOpenTransaction: true })).toBe("Transaktion offen");
  });
});

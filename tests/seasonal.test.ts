import { beforeEach, describe, expect, test } from "bun:test";
import {
  claimSpiderVisit,
  endSpiderVisit,
  isHalloween,
  leaveSpider,
  SPIDER_PREVIEW_QUIP,
  spiderVisitedToday,
  useSeasonalStore,
  visitSpider,
} from "@/lib/seasonal";
import { DEFAULT_SETTINGS, useSettingsStore } from "@/lib/settings";
import { spiderQuip } from "@/lib/spider-quip";

const EVENING = new Date(2026, 9, 28, 19, 40);

function rows(count: number, row: Record<string, unknown> = { id: 1, name: "Anna" }) {
  return Array.from({ length: count }, () => row);
}

function quips(columns: string[], data: Record<string, unknown>[], date = EVENING) {
  return new Set(
    Array.from({ length: 40 }, (_, index) => spiderQuip(columns, data, index / 40, date)),
  );
}

beforeEach(() => {
  window.localStorage.removeItem("l8db.seasonal.spider");
  endSpiderVisit();
});

describe("isHalloween", () => {
  test("gilt vom 18. bis 31. Oktober", () => {
    expect(isHalloween(new Date(2026, 9, 17, 23, 59))).toBe(false);
    expect(isHalloween(new Date(2026, 9, 18, 0, 0))).toBe(true);
    expect(isHalloween(new Date(2026, 9, 31, 23, 59))).toBe(true);
    expect(isHalloween(new Date(2026, 10, 1, 0, 0))).toBe(false);
    expect(isHalloween(new Date(2027, 2, 20))).toBe(false);
  });
});

describe("spiderQuip", () => {
  test("besondere Zeilenzahlen haben Vorrang", () => {
    expect(spiderQuip(["id"], [], 0.5, EVENING)).toBe("0 Zeilen. Nicht mal ein Gespenst.");
    expect(spiderQuip(["id"], rows(13), 0.5, EVENING)).toBe("Genau 13 Zeilen. Ich sag ja nur.");
    expect(spiderQuip(["id"], rows(666), 0.5, EVENING)).toContain("666 Zeilen");
  });

  test("erkennt heikle Spaltennamen, ohne Werte zu zitieren", () => {
    const data = rows(3, { id: 1, password_hash: "geheim123", deleted_at: null, umsatz: 9 });
    const found = quips(["id", "password_hash", "deleted_at", "umsatz"], data);
    expect(found).toContain("„password_hash“? Keine Sorge, ich bin verschwiegen wie ein Grab.");
    expect(found).toContain("„deleted_at“ – hier ruhen die gelöschten Zeilen in Frieden.");
    expect(found).toContain("„umsatz“ – hoffentlich keine Horrorzahlen.");
    expect([...found].some((quip) => quip.includes("geheim123"))).toBe(false);
  });

  test("zählt NULL-Anteile und Spalten", () => {
    const columns = ["id", "a", "b", "c", "d", "e", "f", "g"];
    const sparse = rows(10, { id: 1, a: null, b: null, c: 1, d: 1, e: 1, f: 1, g: 1 });
    const full = rows(10, { id: 1, a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1 });
    expect(quips(columns, sparse)).toContain("25 % NULL. Hier spukt es gewaltig.");
    expect(quips(columns, full)).toContain("Keine einzige NULL. Verdächtig sauber.");
    expect(quips(columns, full)).toContain("Acht Spalten – genau wie meine Beine.");
    expect(quips([...columns, "h"], full)).toContain("9 Spalten und ich hab nur acht Beine.");
  });

  test("kennt einzelne Zeilen, große Ergebnisse und die Nachtschicht", () => {
    expect(quips(["id"], rows(1))).toContain("Eine einzige Zeile. Ganz schön einsam hier.");
    expect(quips(["id"], rows(12_345))).toContain("12.345 Zeilen. Da verheddert sich jede Spinne.");
    expect(quips(["id"], rows(5), new Date(2026, 9, 28, 23, 30))).toContain(
      "Nachtschicht? Ich bin auch nachtaktiv.",
    );
    expect(quips(["id"], rows(5))).not.toContain("Nachtschicht? Ich bin auch nachtaktiv.");
  });

  test("bleibt bei jedem Zufallswert im gültigen Bereich", () => {
    for (const pick of [0, 0.5, 0.999_999, 1])
      expect(spiderQuip(["id", "name"], rows(5), pick, EVENING).length).toBeGreaterThan(0);
    expect(spiderQuip(["id"], rows(5), 0, EVENING)).toBe(
      "5 Zeilen durchgesehen. Keine Leichen im Keller.",
    );
  });

  test("kürzt lange Spaltennamen", () => {
    const column = `password_${"x".repeat(40)}`;
    expect(spiderQuip([column], rows(2, { [column]: 1 }), 0, EVENING)).toBe(
      `„${column.slice(0, 27)}…“? Keine Sorge, ich bin verschwiegen wie ein Grab.`,
    );
  });
});

describe("Tagesbesuch", () => {
  test("die Spinne kommt höchstens einmal am Tag", () => {
    expect(spiderVisitedToday(EVENING)).toBe(false);
    expect(claimSpiderVisit(EVENING)).toBe(true);
    expect(spiderVisitedToday(EVENING)).toBe(true);
    expect(claimSpiderVisit(new Date(2026, 9, 28, 23, 59))).toBe(false);
    expect(claimSpiderVisit(new Date(2026, 9, 29, 8, 0))).toBe(true);
  });

  test("ohne nutzbaren Speicher bleibt sie weg", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(spiderVisitedToday(EVENING, broken)).toBe(true);
    expect(claimSpiderVisit(EVENING, broken)).toBe(false);
    expect(claimSpiderVisit(EVENING, null)).toBe(false);
  });
});

describe("Besuch und Einstellung", () => {
  test("die Vorschau gilt nur bis zum Ende des Besuchs", () => {
    visitSpider({ x: 10, top: 0, y: 20 }, SPIDER_PREVIEW_QUIP, true);
    expect(useSeasonalStore.getState()).toMatchObject({
      preview: true,
      visit: { x: 10, top: 0, y: 20, quip: SPIDER_PREVIEW_QUIP },
    });
    endSpiderVisit();
    expect(useSeasonalStore.getState()).toEqual({ visit: null, preview: false });
  });

  test("ein verschwundenes Raster schickt nur seine eigene Spinne weg", () => {
    const first = visitSpider({ x: 1, top: 0, y: 2 }, "eins");
    const second = visitSpider({ x: 3, top: 0, y: 4 }, "zwei");
    expect(second).not.toBe(first);
    leaveSpider(first);
    expect(useSeasonalStore.getState().visit).toMatchObject({ id: second, quip: "zwei" });
    expect(useSeasonalStore.getState().visit?.leaving).toBeUndefined();
    leaveSpider(second);
    expect(useSeasonalStore.getState().visit).toMatchObject({ id: second, leaving: true });
  });

  test("saisonale Akzente sind standardmäßig an und abschaltbar", () => {
    useSettingsStore.setState(structuredClone(DEFAULT_SETTINGS));
    expect(useSettingsStore.getState().seasonalAccents).toBe(true);
    useSettingsStore.getState().setSeasonalAccents(false);
    expect(useSettingsStore.getState().seasonalAccents).toBe(false);
    useSettingsStore.getState().resetAppearance();
    expect(useSettingsStore.getState().seasonalAccents).toBe(true);
  });
});

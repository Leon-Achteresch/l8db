import { beforeEach, describe, expect, test } from "bun:test";
import {
  claimHolidayVisit,
  claimSpiderVisit,
  endSpiderVisit,
  holidayVisitedToday,
  isHalloween,
  leaveSpider,
  SPIDER_PREVIEW_QUIP,
  spiderVisitedToday,
  useSeasonalStore,
  visitHoliday,
  visitSpider,
} from "@/lib/seasonal";
import { easterSunday, HOLIDAYS, holidayForDate } from "@/lib/seasonal-calendar";
import { seasonalQuip } from "@/lib/seasonal-quip";
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

describe("Feiertagskalender", () => {
  test("berechnet Ostern auch in frühen, späten und Schaltjahren", () => {
    for (const [year, month, day] of [
      [2024, 3, 31],
      [2026, 4, 5],
      [2027, 3, 28],
      [2038, 4, 25],
      [2008, 3, 23],
      [2100, 3, 28],
    ]) {
      expect(easterSunday(year)).toEqual(new Date(year, month - 1, day));
    }
  });

  test("hat für jeden Gast einen erreichbaren Termin", () => {
    const found = new Set<string>();
    for (let day = 1; day <= 366; day++) {
      const holiday = holidayForDate(new Date(2026, 0, day));
      if (holiday) found.add(holiday);
    }
    expect([...found].sort()).toEqual(HOLIDAYS.map((holiday) => holiday.id).sort());
    expect(new Set(HOLIDAYS.map((holiday) => holiday.id)).size).toBe(HOLIDAYS.length);
  });

  test("grenzt feste Zeitfenster, Jahreswechsel und Advent ab", () => {
    for (const [month, day, expected] of [
      [1, 1, "new-year"],
      [1, 2, "new-year"],
      [1, 3, null],
      [1, 6, "epiphany"],
      [2, 12, null],
      [2, 13, "valentine"],
      [2, 14, "valentine"],
      [3, 8, "women-day"],
      [5, 1, "labour-day"],
      [8, 15, "assumption"],
      [10, 3, "unity"],
      [10, 17, null],
      [10, 18, "halloween"],
      [10, 31, "halloween"],
      [11, 1, "remembrance"],
      [11, 11, "martin"],
      [11, 18, "remembrance"],
      [11, 28, null],
      [11, 29, "advent"],
      [12, 4, "advent"],
      [12, 5, "nicholas"],
      [12, 6, "nicholas"],
      [12, 7, "advent"],
      [12, 23, "advent"],
      [12, 24, "christmas"],
      [12, 26, "christmas"],
      [12, 27, null],
      [12, 31, "new-year"],
    ] as const)
      expect(holidayForDate(new Date(2026, month - 1, day, 23, 59))).toBe(expected);
    expect(holidayForDate(new Date("invalid"))).toBeNull();
    expect(holidayForDate(new Date(2023, 11, 3))).toBe("advent");
    expect(holidayForDate(new Date(2023, 10, 26))).toBeNull();
  });

  test("bewegliche Feste bleiben über Sommerzeitwechsel korrekt", () => {
    for (const year of [2027, 2028, 2038]) {
      const easter = easterSunday(year);
      for (const [offset, expected] of [
        [-51, null],
        [-50, "carnival"],
        [-47, "carnival"],
        [-46, null],
        [-7, "easter"],
        [-2, "easter"],
        [0, "easter"],
        [1, "easter"],
        [2, null],
        [39, "fathers-day"],
        [49, "pentecost"],
        [50, "pentecost"],
        [60, "corpus-christi"],
      ] as const) {
        const date = new Date(year, easter.getMonth(), easter.getDate() + offset, 12);
        expect(holidayForDate(date)).toBe(expected);
      }
    }
    expect(holidayForDate(new Date(2024, 1, 13))).toBe("valentine");
    expect(holidayForDate(new Date(2026, 1, 14))).toBe("valentine");
    expect(holidayForDate(new Date(2026, 4, 10))).toBe("mothers-day");
    expect(holidayForDate(new Date(2026, 4, 9))).toBeNull();
  });
});

describe("Feiertagsgäste", () => {
  test("alle Gäste haben eigene Sprüche, ohne Datenwerte zu lesen", () => {
    const data = new Proxy(rows(20), {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key))
          throw new Error("Row values must not be read");
        return Reflect.get(target, key, receiver);
      },
    });
    for (const holiday of HOLIDAYS.filter((holiday) => holiday.id !== "halloween")) {
      expect(seasonalQuip(holiday.id, ["secret"], data, 0)).toBe(holiday.quip);
      expect(seasonalQuip(holiday.id, ["secret"], data, 1).length).toBeGreaterThan(0);
    }
    expect(seasonalQuip("halloween", ["id"], rows(13), 0)).toBe("Genau 13 Zeilen. Ich sag ja nur.");
    expect(seasonalQuip("easter", [], [], 1)).toContain("versteckt");
    expect(seasonalQuip("valentine", ["id"], rows(1), 1)).toContain("Single");
  });

  test("Tagesbesuche sind pro Feiertag begrenzt; Vorschauen verbrauchen keinen Besuch", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    for (const holiday of HOLIDAYS) {
      expect(claimHolidayVisit(holiday.id, EVENING, storage)).toBe(true);
      expect(holidayVisitedToday(holiday.id, EVENING, storage)).toBe(true);
      expect(claimHolidayVisit(holiday.id, EVENING, storage)).toBe(false);
      expect(claimHolidayVisit(holiday.id, EVENING, null)).toBe(false);
    }
    expect(values.size).toBe(HOLIDAYS.length);
    expect(values.get("l8db.seasonal.spider")).toBe("2026-10-28");
    visitHoliday("easter", { x: 100, top: 0, y: 60 }, "Hops!", true);
    expect(useSeasonalStore.getState()).toMatchObject({
      preview: true,
      visit: { holiday: "easter" },
    });
    endSpiderVisit();
    expect(useSeasonalStore.getState()).toEqual({ visit: null, preview: false });
    expect(holidayVisitedToday("easter", EVENING)).toBe(false);
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

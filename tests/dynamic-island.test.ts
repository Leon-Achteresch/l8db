import { beforeEach, describe, expect, test } from "bun:test";
import {
  countQuery,
  formatIslandDuration,
  greetingMoment,
  greetingName,
  ISLAND_QUEUE_LIMIT,
  type IslandMoment,
  productionQuip,
  showIslandMoment,
  takeVersionChange,
  taskMoment,
  useIslandStore,
} from "@/lib/dynamic-island";

beforeEach(() => {
  useIslandStore.setState({ queue: [] });
  window.localStorage.removeItem("l8db.island.version");
  window.localStorage.removeItem("l8db.island.queries");
});

describe("greetingName", () => {
  test("leitet den Vornamen aus dem Home-Verzeichnis ab", () => {
    expect(greetingName("/Users/leon")).toBe("Leon");
    expect(greetingName("C:\\Users\\leon.achteresch")).toBe("Leon");
    expect(greetingName("/home/Leon-Achteresch/")).toBe("Leon");
  });

  test("ignoriert technische Konten", () => {
    expect(greetingName("/root")).toBeNull();
    expect(greetingName("/home/admin")).toBeNull();
    expect(greetingName("/home/user42")).toBeNull();
    expect(greetingName(null)).toBeNull();
  });
});

describe("greetingMoment", () => {
  test("wählt die Begrüßung nach Tageszeit", () => {
    expect(greetingMoment(new Date(2026, 9, 6, 8, 0), "Leon", 0).title).toBe("Guten Morgen, Leon");
    expect(greetingMoment(new Date(2026, 9, 6, 12, 30), "Leon", 0).title).toBe("Mahlzeit, Leon");
    expect(greetingMoment(new Date(2026, 9, 6, 2, 0), "Leon", 0).title).toBe("Noch wach, Leon?");
    expect(greetingMoment(new Date(2026, 9, 6, 9, 0), null, 0.9).title).toBe("Moin");
  });

  test("ergänzt Wochentagshinweise", () => {
    expect(greetingMoment(new Date(2026, 9, 5, 9, 0), "Leon", 0).detail).toBe(
      "Neue Woche, neue Queries",
    );
    expect(greetingMoment(new Date(2026, 9, 3, 15, 0), "Leon", 0).detail).toBe(
      "Wochenendschicht? Respekt.",
    );
    expect(greetingMoment(new Date(2026, 9, 7, 15, 0), "Leon", 0).detail).toBeUndefined();
  });

  test("feiert besondere Tage", () => {
    const pi = greetingMoment(new Date(2026, 2, 14, 10, 0), "Leon");
    expect(pi.title).toBe("Happy Pi Day, Leon");
    expect(pi.detail).toBe("π ≈ 3,14159");
    expect(pi.tone).toBe("celebrate");
    expect(greetingMoment(new Date(2026, 3, 1, 10, 0), "Leon").title).toBe(
      "SELECT 'April, April!';",
    );
    expect(greetingMoment(new Date(2026, 8, 13, 10, 0), "Leon").title).toBe(
      "Happy Programmer's Day, Leon",
    );
    expect(greetingMoment(new Date(2028, 8, 12, 10, 0), null).title).toBe("Happy Programmer's Day");
    expect(greetingMoment(new Date(2026, 6, 31, 10, 0), null).title).toBe("Happy SysAdmin Day");
    expect(greetingMoment(new Date(2026, 6, 24, 10, 0), null, 0).title).toBe("Guten Morgen");
  });
});

describe("Island-Momente", () => {
  test("formatiert Dauern deutsch", () => {
    expect(formatIslandDuration(2400)).toBe("2,4 s");
    expect(formatIslandDuration(65_000)).toBe("1:05 min");
  });

  test("meldet nur spürbar lange Aufgaben", () => {
    const base = { id: "t", title: "CSV-Export", startedAt: 1_000, cancellable: false };
    expect(taskMoment({ ...base, status: "success", finishedAt: 1_200 })).toBeNull();
    const done = taskMoment({ ...base, status: "success", finishedAt: 3_400 });
    expect(done?.glyph.kind).toBe("check");
    expect(done?.detail).toBe("2,4 s");
    expect(taskMoment({ ...base, status: "error", finishedAt: 3_400 })?.glyph.kind).toBe("cross");
  });

  test("überlässt SQL-Abfragen und Skripte dem Footer", () => {
    for (const title of ["SQL-Abfrage", "SQL-Skript"])
      for (const status of ["success", "error", "cancelled"] as const)
        expect(
          taskMoment({
            id: "q",
            title,
            startedAt: 0,
            finishedAt: 5_000,
            cancellable: false,
            status,
          }),
        ).toBeNull();
  });

  test("kommentiert Produktion nur freitags und nachts", () => {
    expect(productionQuip(new Date(2026, 9, 9, 15, 0))?.title).toBe("Freitag + Produktion");
    expect(productionQuip(new Date(2026, 9, 7, 10, 0))).toBeNull();
    expect(productionQuip(new Date(2026, 9, 7, 23, 15))?.title).toBe("Produktion um 23:15");
  });

  test("erkennt Versionswechsel erst ab dem zweiten Start", () => {
    expect(takeVersionChange("0.9.0")).toBeNull();
    expect(takeVersionChange("0.9.0")).toBeNull();
    expect(takeVersionChange("0.10.0")).toBe("0.10.0");
    expect(takeVersionChange(null)).toBeNull();
  });

  test("zählt Abfragen bis zum Meilenstein", () => {
    window.localStorage.setItem("l8db.island.queries", "98");
    expect(countQuery()).toBeNull();
    expect(countQuery()).toBe(100);
    expect(countQuery()).toBeNull();
  });
});

describe("showIslandMoment", () => {
  const moment = (key: string): IslandMoment => ({
    key,
    glyph: { kind: "check" },
    title: key,
    duration: 1000,
  });
  const keys = () => useIslandStore.getState().queue.map((entry) => entry.key);

  test("begrenzt die Queue und behält den sichtbaren Moment", () => {
    for (let i = 0; i < 50; i++) showIslandMoment(moment(`m${i}`));
    expect(keys()).toHaveLength(ISLAND_QUEUE_LIMIT);
    expect(keys()[0]).toBe("m0");
    expect(keys().slice(1)).toEqual(["m45", "m46", "m47", "m48", "m49"]);
  });

  test("ersetzt Momente mit gleichem Key statt sie zu stapeln", () => {
    showIslandMoment(moment("a"));
    showIslandMoment(moment("b"));
    for (let i = 0; i < 10; i++) showIslandMoment(moment("b"));
    expect(keys()).toEqual(["a", "b"]);
  });
});

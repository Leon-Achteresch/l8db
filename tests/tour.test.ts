import { describe, expect, test } from "bun:test";
import { flattenTour, TOUR_CHAPTERS, tourProgress } from "../src/lib/tour/chapters";
import {
  clickSelector,
  isWaitMet,
  nextTourPosition,
  prevTourPosition,
  selectorExists,
  shouldSkipStep,
} from "../src/lib/tour/conditions";

describe("tour script", () => {
  test("hat eindeutige Kapitel- und Schritt-IDs", () => {
    const chapterIds = TOUR_CHAPTERS.map((chapter) => chapter.id);
    const stepIds = flattenTour().map((entry) => entry.step.id);
    expect(new Set(chapterIds).size).toBe(chapterIds.length);
    expect(new Set(stepIds).size).toBe(stepIds.length);
    expect(TOUR_CHAPTERS.length).toBeGreaterThanOrEqual(8);
  });

  test("zählt den Fortschritt über Kapitelgrenzen", () => {
    expect(tourProgress(0, 0)).toEqual({ current: 1, total: flattenTour().length });
    const firstLen = TOUR_CHAPTERS[0].steps.length;
    expect(tourProgress(1, 0).current).toBe(firstLen + 1);
  });

  test("gibt beim Speichern den gesamten Editor frei", () => {
    const saveStep = TOUR_CHAPTERS[1].steps.find((step) => step.id === "save-connection");
    expect(saveStep?.target).toBe("[data-tour='connection-editor']");
  });

  test("springt zum nächsten Kapitel nach dem letzten Schritt", () => {
    const last = TOUR_CHAPTERS[0].steps.length - 1;
    expect(nextTourPosition(0, last)).toEqual({ chapterIndex: 1, stepIndex: 0 });
    expect(prevTourPosition(1, 0)).toEqual({ chapterIndex: 0, stepIndex: last });
    expect(prevTourPosition(0, 0)).toBeNull();
    const lastChapter = TOUR_CHAPTERS.length - 1;
    const lastStep = TOUR_CHAPTERS[lastChapter].steps.length - 1;
    expect(nextTourPosition(lastChapter, lastStep)).toBeNull();
  });
});

describe("tour waits", () => {
  test("route-Wartebedingung prüft den Pfad", () => {
    expect(
      isWaitMet({ type: "route", includes: "/tables/" }, 0, false, "/tables/public/users"),
    ).toBe(true);
    expect(isWaitMet({ type: "route", includes: "/tables/" }, 0, false, "/query")).toBe(false);
  });

  test("click-Wartebedingung braucht den Klick", () => {
    expect(isWaitMet({ type: "click", selector: "[data-tour='x']" }, 0, false, "/")).toBe(false);
    expect(isWaitMet({ type: "click", selector: "[data-tour='x']" }, 0, true, "/")).toBe(true);
  });
});

describe("tour skip", () => {
  test("editor-open ist ohne DOM falsch", () => {
    expect(shouldSkipStep("editor-open")).toBe(false);
  });

  test("ohne DOM existiert kein Selektor und kein Klick", () => {
    expect(selectorExists("[data-tour='connection-editor']")).toBe(false);
    expect(clickSelector("[data-tour='connection-add']")).toBe(false);
  });
});

describe("tour script vollständig", () => {
  test("jeder Schritt hat Titel und Body", () => {
    for (const entry of flattenTour()) {
      expect(entry.step.title.trim().length).toBeGreaterThan(0);
      expect(entry.step.body.trim().length).toBeGreaterThan(0);
      expect(entry.step.action.trim().length).toBeGreaterThan(0);
    }
  });

  test("jeder Warte-Schritt erklärt das Warten", () => {
    for (const entry of flattenTour()) {
      if (entry.step.wait) expect(entry.step.waitHint?.trim().length).toBeGreaterThan(0);
    }
  });

  test("alle Targets sind data-tour-Selektoren", () => {
    for (const entry of flattenTour()) {
      if (entry.step.target) expect(entry.step.target.startsWith("[data-tour=")).toBe(true);
      if (entry.step.autoClick) expect(entry.step.autoClick.startsWith("[data-tour=")).toBe(true);
    }
  });

  test("Info-Schritte ohne Target blockieren nichts", () => {
    const over = flattenTour().filter((entry) => !entry.step.target || entry.step.side === "over");
    expect(over.length).toBeGreaterThan(0);
    for (const entry of over) expect(entry.step.wait?.type).not.toBe("element");
  });
});

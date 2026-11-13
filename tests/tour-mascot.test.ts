import { describe, expect, test } from "bun:test";
import {
  parseTourAnswer,
  TOUR_HISTORY_TURNS,
  TOUR_QUESTION_MAX,
  tourAskMessages,
  tourKnowledge,
} from "../src/lib/tour/ask";
import { flattenTour } from "../src/lib/tour/chapters";
import { type Rect, tourPlacement } from "../src/lib/tour/placement";

const VIEWPORT = { width: 1440, height: 900 };
const MASCOT = { width: 60, height: 68 };
const BUBBLE = { width: 352, height: 260 };

function intersects(a: Rect, b: Rect) {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

function boxes(target: Rect | null, preferred?: "top" | "right" | "bottom" | "left") {
  const placement = tourPlacement({
    target,
    viewport: VIEWPORT,
    mascot: MASCOT,
    bubble: BUBBLE,
    preferred,
  });
  return {
    placement,
    mascot: { left: placement.mascot.x, top: placement.mascot.y, ...MASCOT },
    bubble: { left: placement.bubble.x, top: placement.bubble.y, ...BUBBLE },
  };
}

function inside(rect: Rect) {
  return (
    rect.left >= 0 &&
    rect.top >= 0 &&
    rect.left + rect.width <= VIEWPORT.width &&
    rect.top + rect.height <= VIEWPORT.height
  );
}

describe("Lumi-Platzierung", () => {
  test("bleibt neben kleinen Zielen überall im Fenster frei vom Ziel", () => {
    for (let left = 0; left <= VIEWPORT.width - 120; left += 160) {
      for (let top = 0; top <= VIEWPORT.height - 40; top += 110) {
        const target = { left, top, width: 120, height: 40 };
        for (const side of ["top", "right", "bottom", "left"] as const) {
          const { mascot, bubble } = boxes(target, side);
          expect(intersects(mascot, target)).toBe(false);
          expect(intersects(bubble, target)).toBe(false);
          expect(inside(mascot)).toBe(true);
          expect(inside(bubble)).toBe(true);
        }
      }
    }
  });

  test("nimmt die bevorzugte Seite, wenn Platz ist", () => {
    const target = { left: 200, top: 300, width: 200, height: 60 };
    const { placement } = boxes(target, "right");
    expect(placement.mascot.x).toBeGreaterThan(target.left + target.width);
    expect(placement.bubbleSide).toBe("right");
    expect(placement.look.x).toBeLessThan(0);
  });

  test("weicht bei riesigen Zielen in die Ecke mit wenig Überdeckung aus", () => {
    const target = { left: 80, top: 60, width: 1100, height: 780 };
    const { mascot, bubble } = boxes(target, "right");
    expect(inside(mascot)).toBe(true);
    expect(inside(bubble)).toBe(true);
    expect(mascot.left + mascot.width).toBeGreaterThan(target.left + target.width);
  });

  test("ohne Ziel steht Lumi mittig und schaut geradeaus", () => {
    const { placement, mascot, bubble } = boxes(null);
    expect(placement.look).toEqual({ x: 0, y: 0 });
    const center = (mascot.left + bubble.left + bubble.width) / 2;
    expect(Math.abs(center - VIEWPORT.width / 2)).toBeLessThan(40);
  });

  test("Performance: 20.000 Platzierungen bleiben im Budget", () => {
    const samples: number[] = [];
    for (let run = 0; run < 20; run++) {
      const started = performance.now();
      for (let index = 0; index < 1000; index++) {
        boxes(
          { left: (index * 37) % 1300, top: (index * 53) % 840, width: 140, height: 44 },
          "bottom",
        );
      }
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    const p95 = samples[Math.floor(samples.length * 0.95)];
    console.info(
      `tour placement 1000 calls: median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`,
    );
    expect(median).toBeLessThan(25);
    expect(p95).toBeLessThan(60);
  });
});

describe("Fragen an Lumi", () => {
  test("trennt Feature-Block ab und behält nur bekannte IDs", () => {
    const answer = parseTourAnswer(
      "Drück **⌘↵** im `SQL-Editor`.\n```feature\nquery.run\ngibt.es.nicht\nquery.format\nquery.history\n```",
    );
    expect(answer.text).toBe("Drück ⌘↵ im SQL-Editor.");
    expect(answer.featureIds).toEqual(["query.run", "query.format"]);
  });

  test("zeigt einen halb gestreamten Feature-Block nicht an", () => {
    expect(parseTourAnswer("Im Editor.\n```feature\nque").text).toBe("Im Editor.");
    expect(parseTourAnswer("Nur Text").featureIds).toEqual([]);
  });

  test("begrenzt Frage und Verlauf", () => {
    const history = Array.from({ length: 9 }, (_, index) => ({
      question: `F${index}`,
      answer: `A${index}`,
    }));
    const messages = tourAskMessages("x".repeat(5000), { title: "Die Suche" }, history, "");
    expect(messages).toHaveLength(TOUR_HISTORY_TURNS * 2 + 1);
    expect(messages[0].text).toBe(`F${9 - TOUR_HISTORY_TURNS}`);
    const last = messages.at(-1)?.text ?? "";
    expect(last).toContain("Aktueller Tour-Schritt: Die Suche");
    expect(last.length).toBeLessThan(TOUR_QUESTION_MAX + 120);
  });

  test("Tour-Wissen enthält jeden Schritt, ist begrenzt und wird wiederverwendet", () => {
    const knowledge = tourKnowledge();
    for (const { step } of flattenTour()) expect(knowledge).toContain(step.title);
    expect(new TextEncoder().encode(knowledge).length).toBeLessThan(24_000);
    expect(tourKnowledge()).toBe(knowledge);
  });
});

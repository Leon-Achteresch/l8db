import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reportScenario } from "../scripts/performance-report";
import { AiAssistantMessage } from "../src/features/ai/ai-assistant-message";
import type { AiMessage } from "../src/lib/db/ai";

if (!("addEventListener" in window))
  Object.assign(window, { addEventListener() {}, removeEventListener() {} });

const turn = (index: number, steps = 8): AiMessage => ({
  id: `a${index}`,
  role: "assistant",
  text: `Antwort ${index}: Der Umsatz ist gestiegen.`,
  reasoning: "Ich prüfe zuerst die Bestelltabelle.",
  createdAt: 0,
  durationMs: 8400,
  rich: Array.from({ length: steps }, (_, step) => ({
    type: "tool" as const,
    id: `t${index}-${step}`,
    name: "query",
    status: "success",
    sql: `SELECT ${step}`,
    output: "monat\tumsatz\n2026-05\t48210\n(1 rows)",
    at: 0,
  })),
});

const render = (message: AiMessage, streaming = false) =>
  renderToStaticMarkup(
    createElement(AiAssistantMessage, {
      message,
      streaming,
      status: "",
      disabled: streaming,
      onRetry: () => undefined,
      onBranch: () => undefined,
    }),
  );

test("finished turns collapse their work into one summary, live turns show every step", () => {
  const done = render(turn(1, 3));
  expect(done).toContain("3 Schritte");
  expect(done).toContain('aria-expanded="false"');
  expect(done).not.toContain("Datenabfrage ausgeführt");
  const live = render({ ...turn(2, 3), durationMs: undefined }, true);
  expect(live).toContain("Datenabfrage ausgeführt");
  expect(live).toContain("Arbeitet");
});

test("120 finished turns with 8 steps each keep the transcript DOM bounded", async () => {
  const turns = Array.from({ length: 120 }, (_, index) => turn(index));
  const times: number[] = [];
  let html = "";
  for (let run = 0; run < 12; run++) {
    const start = performance.now();
    html = turns.map((message) => render(message)).join("");
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const medianMs = times[Math.floor(times.length / 2)];
  const p95Ms = times[Math.ceil(times.length * 0.95) - 1];
  const elements = html.match(/<[a-z][^>]*>/g)?.length ?? 0;
  expect(html).not.toContain("Datenabfrage ausgeführt");
  expect(elements / turns.length).toBeLessThan(40);
  expect(medianMs).toBeLessThan(250);
  expect(p95Ms).toBeLessThan(500);
  await reportScenario("ai-transcript-collapsed-work", {
    turns: turns.length,
    stepsPerTurn: 8,
    elements,
    elementsPerTurn: Math.round(elements / turns.length),
    medianMs,
    p95Ms,
  });
});

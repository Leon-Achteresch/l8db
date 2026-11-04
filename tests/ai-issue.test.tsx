import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reportScenario } from "../scripts/performance-report";
import { AiIssueCard } from "../src/features/ai/ai-issue-card";
import { AiIssueResult } from "../src/features/ai/ai-issue-result";
import { githubIssueUrl } from "../src/lib/ai/issue-presentation";
import { mergeAiRich, normalizeAiRich, sanitizeAiRich } from "../src/lib/ai/rich";
import { hasNewFeatures, NEW_FEATURES, type NewFeatureId } from "../src/lib/new-features";

test("issue history retains the exact redacted body across partial results and reloads", () => {
  const initial = normalizeAiRich({
    kind: "tool",
    data: {
      id: "issue",
      name: "report_issue",
      status: "running",
      arguments: { title: "Fehler", body: "### Umgebung\npassword=private-value\nTestsystem" },
    },
  });
  const completed = mergeAiRich(
    initial,
    normalizeAiRich({
      kind: "tool",
      data: {
        id: "issue",
        name: "report_issue",
        status: "completed",
        result: {
          content: [
            {
              type: "text",
              text: "Issue erstellt: https://github.com/Leon-Achteresch/l8db/issues/123",
            },
          ],
        },
      },
    }),
  );
  const saved = sanitizeAiRich(JSON.parse(JSON.stringify(completed)));
  expect(saved[0]).toMatchObject({
    name: "report_issue",
    title: "Fehler",
    body: "### Umgebung\npassword=[redacted]\nTestsystem",
    status: "success",
  });
  expect(JSON.stringify(saved)).not.toContain("private-value");
  expect(NEW_FEATURES["ai.chat.issue-cards"]).toBe("0.17.0");
  expect(hasNewFeatures("ai.chat", new Set(), "0.17.0")).toBe(true);
});

test("issue links only open the intended repository without hidden destinations", () => {
  const url = "https://github.com/Leon-Achteresch/l8db/issues/123";
  expect(githubIssueUrl(`Issue erstellt: ${url}`)).toBe(url);
  for (const output of [
    "https://evil.example/issues/123",
    `${url}?token=secret`,
    `${url}/other`,
    "https://github.com/Leon-Achteresch/l8db/issues/0",
    `https://evil.example/${url}`,
  ])
    expect(githubIssueUrl(output)).toBeUndefined();
});

test("reading the issue introduction clears its AI navigation badge", () => {
  const seen = new Set(
    (Object.keys(NEW_FEATURES) as NewFeatureId[]).filter((id) => id !== "ai.chat.issue-cards"),
  );
  expect(hasNewFeatures("ai", seen, "0.17.0")).toBe(true);
  seen.add("ai.chat.issue-cards");
  expect(hasNewFeatures("ai.chat", seen, "0.17.0")).toBe(false);
  expect(hasNewFeatures("ai", seen, "0.17.0")).toBe(false);
});

test("issues remain actionable in easy mode and interrupted reports never appear sent", () => {
  const render = (status: string, output: string) =>
    renderToStaticMarkup(
      createElement(AiIssueResult, {
        block: {
          type: "tool",
          id: "1",
          name: "report_issue",
          title: "Fehler",
          body: "Beschreibung",
          status,
          output,
        },
        running: false,
      }),
    );
  expect(render("running", "")).toContain("Nicht gesendet");
  expect(render("error", "Dienst nicht erreichbar")).toContain("Dienst nicht erreichbar");
  expect(render("success", "missing URL")).toContain("Senden fehlgeschlagen");
  expect(
    render("success", "Issue erstellt: https://github.com/Leon-Achteresch/l8db/issues/123"),
  ).toContain("Auf GitHub");
});

test("80 large issue cards keep previews unmounted with bounded rendering cost", async () => {
  const body = `### Diagnose\n${"Große Fehlerbeschreibung. ".repeat(1400)}`;
  const cards = Array.from({ length: 80 }, (_, index) =>
    createElement(AiIssueCard, {
      key: index,
      title: `Fehler ${index}`,
      body,
      screenshot: `data:image/png;base64,${"A".repeat(2000000)}`,
    }),
  );
  const times: number[] = [];
  let html = "";
  for (let run = 0; run < 12; run++) {
    const start = performance.now();
    html = renderToStaticMarkup(createElement("div", null, ...cards));
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const medianMs = times[Math.floor(times.length / 2)];
  const p95Ms = times[Math.ceil(times.length * 0.95) - 1];
  const elements = html.match(/<[a-z][^>]*>/g)?.length ?? 0;
  expect(html.match(/data-ai-issue-card/g)).toHaveLength(80);
  expect(html).not.toContain("Große Fehlerbeschreibung");
  expect(html).not.toContain("<img");
  expect(html).not.toContain('role="dialog"');
  expect(elements).toBeLessThan(6000);
  expect(medianMs).toBeLessThan(100);
  expect(p95Ms).toBeLessThan(250);
  await reportScenario("ai-issue-cards", {
    cards: 80,
    bodyChars: body.length,
    screenshotChars: 2000000,
    elements,
    medianMs,
    p95Ms,
    previewImages: 0,
  });
});

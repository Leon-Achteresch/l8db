import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorAiPrompt } from "../src/features/query/editor-ai/editor-ai-prompt";
import type { EditSnapshot, InlineEditSession } from "../src/lib/ai/editor/inline-edit";

function render(patch: Partial<EditSnapshot>) {
  const snapshot = {
    id: "s",
    phase: "input",
    action: "edit",
    instruction: "",
    placeholder: "Abfrage ändern …",
    status: "",
    error: "",
    warning: "",
    streamed: 0,
    model: "",
    usage: null,
    earlier: [],
    hunks: [],
    pending: 0,
    font: { family: "monospace", size: 13, lineHeight: 20 },
    ...patch,
  } as unknown as EditSnapshot;
  return renderToStaticMarkup(
    createElement(EditorAiPrompt, { session: {} as InlineEditSession, snapshot }),
  );
}

test("running edit shows the status and the sent instruction instead of the typed text", () => {
  const html = render({
    phase: "running",
    instruction: "nach Monat gruppieren",
    status: "Schreibt …",
  });
  expect(html).toContain('placeholder="Schreibt … „nach Monat gruppieren“"');
  expect(html).not.toContain(">nach Monat gruppieren</textarea>");
  const waiting = render({ phase: "running", instruction: "x".repeat(200) });
  expect(waiting).toContain(`placeholder="Denkt nach … „${"x".repeat(80)}…“"`);
});

test("review keeps the follow-up hint", () => {
  expect(render({ phase: "review", instruction: "a" })).toContain("Weiter anpassen …");
});

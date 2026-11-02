import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../src/components/ui/button";

test("wraps a disabled button with a reason in a focusable tooltip trigger", () => {
  const markup = renderToStaticMarkup(
    createElement(Button, { disabled: true, disabledReason: "Kein Ziel ausgewählt" }, "Los"),
  );
  expect(markup).toStartWith('<span class="inline-flex" tabindex="0"');
  expect(markup).toContain("disabled");
});

test("renders a plain button when enabled or without a reason", () => {
  for (const props of [{ disabledReason: "Kein Ziel ausgewählt" }, { disabled: true }]) {
    expect(renderToStaticMarkup(createElement(Button, props, "Los"))).toStartWith("<button");
  }
});

test("keeps rendering 500 disabled buttons with reasons cheap", () => {
  const buttons = Array.from({ length: 500 }, (_, index) =>
    createElement(Button, { key: index, disabled: true, disabledReason: "Kein Ziel" }, "Los"),
  );
  const samples: number[] = [];
  for (let run = 0; run < 7; run += 1) {
    const start = performance.now();
    renderToStaticMarkup(createElement("div", null, buttons));
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  expect(samples[3]).toBeLessThan(150);
});

import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Collapse } from "../src/components/motion/collapse";

test("rendert geschlossen nichts", () => {
  const markup = renderToStaticMarkup(
    createElement(Collapse, { open: false }, createElement("span", null, "Inhalt")),
  );
  expect(markup).toBe("");
});

test("rendert geöffnet den Inhalt in einem 1fr-Grid", () => {
  const markup = renderToStaticMarkup(
    createElement(Collapse, { open: true }, createElement("span", null, "Inhalt")),
  );
  expect(markup).toContain("Inhalt");
  expect(markup).toContain("grid-template-rows:1fr");
});

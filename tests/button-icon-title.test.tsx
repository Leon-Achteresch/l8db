import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../src/components/ui/button";

const html = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(Button, props, "x"));

test("Icon-Knöpfe zeigen ihren Namen als Tooltip", () => {
  expect(html({ size: "icon-sm", "aria-label": "Filter" })).toContain('title="Filter"');
  expect(html({ size: "icon", "aria-label": "A", title: "Eigen" })).toContain('title="Eigen"');
  expect(html({ size: "sm", "aria-label": "Text" })).not.toContain("title=");
  expect(html({ size: "icon", "aria-label": "T", "data-state": "closed" })).not.toContain("title=");
  expect(
    html({ size: "icon", "aria-label": "Menü", "data-state": "closed", "aria-haspopup": "menu" }),
  ).toContain('title="Menü"');
});

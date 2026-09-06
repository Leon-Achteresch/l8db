import { describe, expect, test } from "bun:test";
import { extractHighlights, parseInline, parseMarkdown } from "../src/lib/markdown";

describe("parseMarkdown", () => {
  test("wandelt Changelog-Markdown in Überschriften und Listen um", () => {
    const blocks = parseMarkdown(
      "## Changelog\n\nErstes Release\n\n### Features\n- custom icons\n- Speichern per Slide-Button",
    );
    expect(blocks).toEqual([
      { t: "h", level: 2, children: [{ t: "text", v: "Changelog" }] },
      { t: "p", children: [{ t: "text", v: "Erstes Release" }] },
      { t: "h", level: 3, children: [{ t: "text", v: "Features" }] },
      {
        t: "ul",
        items: [[{ t: "text", v: "custom icons" }], [{ t: "text", v: "Speichern per Slide-Button" }]],
      },
    ]);
  });

  test("zieht die ersten Changelog-Punkte als Highlights", () => {
    expect(
      extractHighlights("## Changelog\n- custom icons\n- Speichern per Slide-Button\n- dritter\n- vierter"),
    ).toEqual(["custom icons", "Speichern per Slide-Button", "dritter"]);
  });

  test("parst Links nur mit Ziel-URL", () => {
    expect(parseInline("siehe [0.1.0](https://example.com) und [Unreleased]")).toEqual([
      { t: "text", v: "siehe " },
      { t: "link", href: "https://example.com", children: [{ t: "text", v: "0.1.0" }] },
      { t: "text", v: " und [Unreleased]" },
    ]);
  });
});

import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandPaletteOption } from "../src/components/motion/command-palette/command-palette-option";

function renderOption(query: string) {
  return renderToStaticMarkup(
    createElement(CommandPaletteOption, {
      item: {
        id: "customers",
        label: "orders.customer_id",
        hint: "Fremdschlüssel auf customers.id",
        onSelect: () => {},
      },
      query,
      index: 0,
      isActive: false,
      uid: "palette",
      reduce: true,
      hasIcons: false,
      onHover: () => {},
      onSelect: () => {},
    }),
  );
}

test("unterstreicht Treffer im Namen und Zusatztext ohne den Optionsinhalt zu ändern", () => {
  const markup = renderOption("cust");
  expect(markup.match(/decoration-blue-500/g)).toHaveLength(2);
  expect(markup).toContain(">cust</span>");
  expect(markup.replace(/<[^>]*>/g, "")).toBe("orders.customer_idFremdschlüssel auf customers.id");
  expect(markup).toContain('role="option"');
  expect(markup).toContain('aria-selected="false"');
});

test("leere Suchanfrage erzeugt keine Unterstreichung", () => {
  expect(renderOption("")).not.toContain("decoration-blue-500");
});

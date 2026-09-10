import { expect, test } from "bun:test";
import { EyeIcon, TableIcon } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarObjectTabs } from "../src/features/sidebar/sidebar-object-tabs";

test("rendert für jeden Objekt-Tab einen zugänglichen Tooltip-Trigger", () => {
  const tabs = [
    { value: "tables", label: "Tabellen", icon: TableIcon },
    { value: "views", label: "Views", icon: EyeIcon },
  ];
  const markup = renderToStaticMarkup(
    createElement(SidebarObjectTabs, {
      tabs,
      value: "tables",
      onValueChange: () => {},
    }),
  );

  expect(markup.match(/aria-describedby=/g)).toHaveLength(tabs.length);
  for (const tab of tabs) {
    expect(markup).toContain(`aria-label="${tab.label}"`);
  }
});

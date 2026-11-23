import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SavedQueryItem } from "../src/features/query/query-history-panel/saved-query-item";
import { SavedQueryOriginChoice } from "../src/features/query/saved-query-origin-choice";
import { savedQueryConnectionNames, savedQueryOriginInfo } from "../src/lib/saved-query-origin";

const origin = { connectionId: "dev", connectionName: "Dev", database: "app" };

test("save choice is explicit, unchecked/general by default and safely unavailable without a context", () => {
  const render = (checked: boolean, value = origin) =>
    renderToStaticMarkup(
      createElement(SavedQueryOriginChoice, { origin: value, checked, onCheckedChange: () => {} }),
    );
  const general = render(false);
  expect(general).toContain('role="checkbox"');
  expect(general).toContain('aria-checked="false"');
  expect(general).toContain("Allgemein · ohne Herkunft");
  expect(general).toContain("kein Ausführungsziel");
  expect(render(true)).toContain("Dev · app");
  const missing = renderToStaticMarkup(
    createElement(SavedQueryOriginChoice, { checked: false, onCheckedChange: () => {} }),
  );
  expect(missing).toContain('disabled=""');
  const unsafe = render(true, { ...origin, connectionName: "postgres://user:password@host" });
  expect(unsafe).not.toContain("postgres://");
});

test("real saved-item row retains SQL opening and shows general/missing/renamed context safely", () => {
  const query = { id: "q", name: "Orders", sql: "SELECT 1", createdAt: 1, origin };
  const connections = savedQueryConnectionNames([{ id: "dev", name: "Staging" }]);
  const render = (entry: typeof query | Omit<typeof query, "origin">, names = connections) =>
    renderToStaticMarkup(
      createElement(SavedQueryItem, {
        entry,
        originInfo: savedQueryOriginInfo("origin" in entry ? entry.origin : undefined, names),
        onLoad: () => {},
        onDelete: () => {},
        onRename: () => {},
      }),
    );
  expect(render(query)).toContain("Staging (gespeichert als Dev) · app");
  expect(render(query)).toContain("In neuem SQL-Tab öffnen");
  expect(render(query)).toContain("SELECT 1");
  expect(render(query, new Map())).toContain("nicht verfügbar");
  expect(render({ id: "old", name: "Old", sql: "SELECT 2", createdAt: 0 })).toContain("Allgemein");
  const escaped = render(
    { ...query, origin: { ...origin, connectionName: "<script>name</script>" } },
    new Map(),
  );
  expect(escaped).not.toContain("<script>");
  expect(escaped).toContain("&lt;script&gt;");
});

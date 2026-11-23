import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  INDEX_ROLE_PREVIEW_COLUMNS,
  IndexRoleDetails,
} from "../src/features/table/table-indexes-list/index-role-details";
import type { IndexRoles } from "../src/lib/db/schema-objects";

export const roles: IndexRoles = {
  keys: [
    { name: "tenant_id", position: 1, descending: false },
    { name: "created_at", position: 2, descending: true },
  ],
  included: ["display_name"],
  other: [],
  filter: { state: "known", predicate: "([status]=(1))" },
  definition_status: "reconstructed",
};
function render(value: IndexRoles) {
  return renderToStaticMarkup(
    createElement(IndexRoleDetails, {
      roles: value,
      definition: "CREATE NONCLUSTERED INDEX … INCLUDE (…) WHERE …",
    }),
  );
}

test("shows keys in ordinal order with direction and separate INCLUDE/filter metadata", () => {
  const html = render(roles);
  expect(html.indexOf("1. tenant_id ASC")).toBeLessThan(html.indexOf("2. created_at DESC"));
  expect(html).toContain("INCLUDE (1)");
  expect(html).toContain('data-index-column="include"');
  expect(html).toContain("Filter: ([status]=(1))");
  expect(html).toContain("Rekonstruierte Definition");
});

test("hidden and unknown filters never look absent or expose a reconstructed definition", () => {
  for (const state of ["unavailable", "unknown"] as const) {
    const html = render({ ...roles, filter: { state }, definition_status: "unavailable" });
    expect(html).not.toContain("Ohne Filter");
    expect(html).not.toContain("CREATE NONCLUSTERED");
    expect(html).toContain(
      state === "unavailable"
        ? "Filter vorhanden · Definition nicht verfügbar"
        : "Filterstatus unbekannt",
    );
    expect(html).toContain("Definition nicht rekonstruiert");
  }
});

test("unclassified columns and unknown direction are not invented INCLUDE or ASC roles", () => {
  const html = render({
    ...roles,
    keys: [{ name: "id", position: 1, descending: null }],
    included: [],
    other: ["a"],
    filter: { state: "none" },
    definition_status: "unavailable",
  });
  expect(html).toContain("Sonstige Indexspalten (1)");
  expect(html).not.toContain("INCLUDE (");
  expect(html).toContain("Sortierrichtung unbekannt");
  expect(html).not.toContain("id ASC");
  expect(html).toContain("Ohne Filter");
});

test("many included columns keep the initial DOM bounded and offer explicit expansion", () => {
  const html = render({
    ...roles,
    included: Array.from({ length: 200 }, (_, i) => `payload_${i}`),
  });
  expect((html.match(/data-index-column="include"/g) ?? []).length).toBe(
    INDEX_ROLE_PREVIEW_COLUMNS,
  );
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain("192 weitere Spalten anzeigen");
});

test("native column names and predicates are escaped as text", () => {
  const html = render({
    ...roles,
    included: ["<script>"],
    filter: { state: "known", predicate: "[note] < '<img>'" },
  });
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("&lt;img&gt;");
});

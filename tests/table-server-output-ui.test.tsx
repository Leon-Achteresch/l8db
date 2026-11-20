import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SavedConnection } from "../src/lib/connections";

const output = await import("../src/lib/server-output");
mock.module("../src/lib/server-output", () => ({
  ...output,
  useServerOutputStore: Object.assign(
    (selector: (state: ReturnType<typeof output.useServerOutputStore.getState>) => unknown) =>
      selector(output.useServerOutputStore.getState()),
    output.useServerOutputStore,
  ),
}));

let panel: { connectionId: string; database: string | null } | undefined;
mock.module("../src/features/query/server-output-panel", () => ({
  ServerOutputPanel: (props: typeof panel) => {
    panel = props;
    return null;
  },
}));
mock.module("../src/components/ui/dialog", () => {
  const box = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return {
    Dialog: box,
    DialogContent: box,
    DialogDescription: box,
    DialogHeader: box,
    DialogTitle: box,
  };
});
const iconMenu = await import("../src/components/icon-menu");
mock.module("../src/components/icon-menu", () => ({
  ...iconMenu,
  IconMenuItem: ({ label }: { label: string }) => createElement("div", null, label),
}));
const { TableServerOutput } = await import("../src/features/table/table-view/table-server-output");
const { TableServerOutputMenuItem } = await import(
  "../src/features/table/table-view/table-server-output-menu-item"
);
const { useServerOutputStore } = await import("../src/lib/server-output");
const noop = () => {};
const connection = { id: "view-output", name: "Fixture", kind: "postgres" } as SavedConnection;

test("actual table output entry counts and forwards only the requested connection/database scope", () => {
  useServerOutputStore.setState({ entries: {}, enabled: {} });
  const store = useServerOutputStore.getState();
  store.append(connection.id, "db", [
    { level: "NOTICE", message: "one" },
    { level: "NOTICE", message: "two" },
  ]);
  store.append(connection.id, "other", [{ level: "NOTICE", message: "hidden" }]);
  const html = renderToStaticMarkup(
    createElement(TableServerOutput, {
      connection,
      database: "db",
      open: true,
      onOpenChange: noop,
    }),
  );
  expect(
    renderToStaticMarkup(
      createElement(TableServerOutputMenuItem, {
        connectionId: connection.id,
        database: "db",
        onSelect: noop,
      }),
    ),
  ).toContain("Server-Ausgabe · 2");
  expect(panel).toMatchObject({ connectionId: connection.id, database: "db" });
  expect(html).toContain("Kein Commit-Nachweis");
  expect(html).toContain("nicht nur diese Tabelle");
});

test("unknown database is a distinct scope and identifiers are escaped", () => {
  useServerOutputStore
    .getState()
    .append(connection.id, null, [{ level: "NOTICE", message: "unknown" }]);
  const html = renderToStaticMarkup(
    createElement(TableServerOutput, {
      connection: { ...connection, name: "<unsafe>" },
      database: null,
      open: true,
      onOpenChange: noop,
    }),
  );
  expect(
    renderToStaticMarkup(
      createElement(TableServerOutputMenuItem, {
        connectionId: connection.id,
        database: null,
        onSelect: noop,
      }),
    ),
  ).toContain("Server-Ausgabe · 1");
  expect(html).toContain("&lt;unsafe&gt;");
  expect(panel?.database).toBeNull();
});

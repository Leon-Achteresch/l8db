import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const invocations: string[] = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    invocations.push(command);
    return null;
  },
}));

Object.assign(window, { addEventListener() {}, removeEventListener() {} });

const { useConnectionsStore } = await import("../src/lib/connections/store");
const { focusedConnectionId, paneConnectionId, useSplitView } = await import(
  "../src/lib/split-view"
);
const { tabKey, useTableTabs } = await import("../src/lib/table-tabs");
const { useTransactionStore } = await import("../src/lib/transactions");
const { transactionsClosedWith, tabHasTransaction } = await import("../src/lib/tab-transactions");
const { formatWindowTitle } = await import("../src/lib/hooks/use-window-title");
const { TabStatusMarkers } = await import("../src/features/shell/table-tabs/tab-status-markers");
const { EnvironmentBanner } = await import("../src/features/shell/environment-banner");

const base = { kind: "postgres" as const, sslMode: "prefer" as const };
const dev = {
  ...base,
  id: "dev",
  name: "Shop Dev",
  connectionString: "postgres://app@dev/shop",
  environment: "development" as const,
};
const prod = {
  ...base,
  id: "prod",
  name: "Shop Prod",
  connectionString: "postgres://app@prod/shop",
  environment: "production" as const,
};
const query = { kind: "query" as const, id: "q1", title: "Abfrage 1", sql: "SELECT 1" };
const query2 = { kind: "query" as const, id: "q2", title: "Abfrage 2", sql: "SELECT 2" };
const orders = { kind: "table" as const, schema: "public", table: "orders" };
const remoteOrders = { ...orders, connectionId: "prod" };

function tx(
  txId: string,
  connectionId: string,
  scope:
    | { type: "connection" }
    | { type: "query" }
    | { type: "table"; schema: string; table: string },
) {
  return { txId, connectionId, connectionName: connectionId, scope, changes: [], startedAt: 0 };
}

function splitState(focusedPane: number) {
  return {
    panes: [tabKey(query), tabKey(remoteOrders)],
    paneTabs: [[tabKey(query)], [tabKey(remoteOrders)]],
    away: false,
    focusedPane,
    paneConnections: {},
  };
}

afterEach(() => {
  useConnectionsStore.setState({ connections: [], hostGroupRules: [], activeId: null });
  useTableTabs.setState({ tabs: [], tabsByConnection: {} });
  useSplitView.setState({ panes: [], paneTabs: [], paneConnections: {}, focusedPane: 0 });
  useTransactionStore.setState({ transactions: [] });
  invocations.length = 0;
});

describe("Umgebung pro Bereich", () => {
  test("Indikatoren folgen sofort dem fokussierten Bereich", () => {
    const connections = [dev, prod];
    const route = tabKey(query);
    expect(focusedConnectionId(splitState(1), route, "dev", connections)).toBe("prod");
    expect(focusedConnectionId(splitState(0), route, "dev", connections)).toBe("dev");
    expect(focusedConnectionId(splitState(1), route, "dev", connections)).toBe("prod");
    expect(focusedConnectionId(splitState(1), route, "prod", connections)).toBe("prod");
    expect(
      focusedConnectionId({ ...splitState(1), away: true }, "table:x.y", "dev", connections),
    ).toBe("dev");
    expect(focusedConnectionId(splitState(1), route, "dev", [dev])).toBe("dev");
  });

  test("Bereich mit gewählter Verbindung nutzt deren Umgebung", () => {
    const state = { paneConnections: { [`dev|${tabKey(orders)}`]: "prod" } };
    expect(paneConnectionId(state, tabKey(orders), "dev", [dev, prod])).toBe("prod");
    expect(paneConnectionId(state, tabKey(orders), "prod", [dev, prod])).toBeNull();
    expect(paneConnectionId(state, tabKey(query), "dev", [dev, prod])).toBeNull();
  });

  test("Banner nur für Produktion, mit Name des Bereichs", () => {
    expect(renderToStaticMarkup(createElement(EnvironmentBanner, { connection: prod }))).toContain(
      "Shop Prod",
    );
    expect(renderToStaticMarkup(createElement(EnvironmentBanner, { connection: dev }))).toBe("");
    expect(renderToStaticMarkup(createElement(EnvironmentBanner, { connection: null }))).toBe("");
  });
});

describe("Fenstertitel", () => {
  test("nennt Produktion und Staging vorne", () => {
    expect(formatWindowTitle("Shop Prod", "shop", "production")).toBe(
      "PROD · Shop Prod · shop – l8db",
    );
    expect(formatWindowTitle("Shop", null, "staging")).toBe("STAGING · Shop – l8db");
    expect(formatWindowTitle("Shop Dev", "shop", "development")).toBe("Shop Dev · shop – l8db");
    expect(formatWindowTitle(null, null, "production")).toBe("l8db");
  });
});

describe("Tab-Markierung", () => {
  const render = (environment: "production" | "development" | null, transaction = false) =>
    renderToStaticMarkup(
      createElement(TabStatusMarkers, { environment, transaction, isActive: false }),
    );

  test("Tabs der aktiven Verbindung zeigen die Umgebung, Produktion mit Buchstabe", () => {
    const production = render("production");
    expect(production).toContain('aria-label="Umgebung Produktion"');
    expect(production).toContain(">P</span>");
    const development = render("development");
    expect(development).toContain('aria-label="Umgebung Entwicklung"');
    expect(development).not.toContain(">P</span>");
    expect(render(null)).toBe("");
  });

  test("offene Transaktion markiert den Tab", () => {
    const open = [tx("t1", "dev", { type: "query" })];
    expect(tabHasTransaction(query, "dev", open)).toBe(true);
    expect(tabHasTransaction(query, "prod", open)).toBe(false);
    expect(render(null, true)).toContain('aria-label="Offene Transaktion"');
    const table = tx("t2", "dev", { type: "table", schema: "public", table: "orders" });
    expect(tabHasTransaction(orders, "dev", [table])).toBe(true);
    expect(tabHasTransaction({ ...orders, table: "items" }, "dev", [table])).toBe(false);
    expect(tabHasTransaction(query, "dev", [table])).toBe(false);
  });
});

describe("Schließschutz für Tabs", () => {
  const setup = () => {
    useConnectionsStore.setState({ connections: [dev, prod], activeId: "dev" });
    useTableTabs.setState({ tabs: [query, query2, orders], tabsByConnection: {} });
    useTransactionStore.setState({
      transactions: [
        tx("query", "dev", { type: "query" }),
        tx("orders", "dev", { type: "table", schema: "public", table: "orders" }),
        tx("remote", "prod", { type: "connection" }),
      ],
    });
  };
  const ids = (keys: string[]) => transactionsClosedWith(keys).map((entry) => entry.txId);

  test("Schließen per Klick, Mittelklick oder Kürzel fragt bei eigener Transaktion", () => {
    setup();
    expect(ids([tabKey(orders)])).toEqual(["orders"]);
    expect(ids([tabKey(query)])).toEqual([]);
  });

  test("Andere und alle schließen fragen einmal für alle verwaisten Transaktionen", () => {
    setup();
    expect(ids([tabKey(query), tabKey(orders)])).toEqual(["orders"]);
    expect(ids([tabKey(query), tabKey(query2), tabKey(orders)])).toEqual(["query", "orders"]);
  });

  test("Tab einer anderen Verbindung im Bereich", () => {
    setup();
    useTableTabs.setState({ tabs: [query], tabsByConnection: {} });
    useTransactionStore.setState({
      transactions: [tx("remote", "prod", { type: "table", schema: "public", table: "orders" })],
    });
    expect(ids([tabKey(remoteOrders)])).toEqual(["remote"]);
    useTableTabs.setState({ tabsByConnection: { prod: [orders] } });
    expect(ids([tabKey(remoteOrders)])).toEqual([]);
    expect(invocations).toEqual([]);
  });
});

import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import {
  connectionShares,
  formatBytes,
  storageAreas,
  storageLabel,
  withoutConnection,
} from "../src/lib/storage-usage";

const ids = ["ora1", "ora2", "ora3", "ora4", "ora5", "ora6"];
const sql = (name: string) =>
  `CREATE OR REPLACE PACKAGE BODY HR.${name} AS\n${"  PROCEDURE p IS BEGIN NULL; END;\n".repeat(1100)}END;`;

function realisticEntries(): [string, string][] {
  const tabs = {
    state: {
      tabsByConnection: Object.fromEntries(
        [...ids, "deleted"].map((id) => [
          id,
          Array.from({ length: 6 }, (_, i) => ({
            kind: "query",
            id: `${id}-${i}`,
            sql: sql(`P${i}`),
          })),
        ]),
      ),
      recentlyClosed: Array.from({ length: 100 }, (_, i) => ({
        kind: "query",
        id: `c${i}`,
        sql: sql(`C${i}`),
        closedConnectionId: ids[i % ids.length],
      })),
    },
    version: 4,
  };
  const history = {
    state: {
      entries: Array.from({ length: 500 }, (_, i) => ({
        id: `h${i}`,
        connectionId: ids[i % ids.length],
        sql: "select * from employees",
      })),
      retentionLimit: 500,
    },
    version: 0,
  };
  const drafts = {
    state: {
      drafts: { [JSON.stringify(["ora2", "XE", "package:HR.PKG"])]: { source: sql("DRAFT") } },
    },
    version: 0,
  };
  const selection = {
    state: { databaseByConnection: { ora1: "XE", ora2: "XE" }, schemaByConnection: { ora1: "HR" } },
    version: 0,
  };
  return [
    ["l8db.table-tabs", JSON.stringify(tabs)],
    ["l8db.query-history", JSON.stringify(history)],
    ["l8db.object-drafts", JSON.stringify(drafts)],
    ["l8db.db-selection", JSON.stringify(selection)],
    [
      "l8db.connections",
      JSON.stringify({ state: { connections: ids.map((id) => ({ id })), activeId: "ora1" } }),
    ],
    ["l8db.settings", '{"state":{"uiScale":100},"version":0}'],
  ];
}

test("attributes stored data to connections, including deleted ones", () => {
  const entries = realisticEntries();
  const shares = connectionShares(entries, ids);
  expect(shares.get("ora1")?.areas.has("l8db.table-tabs")).toBe(true);
  expect(shares.get("ora1")?.areas.has("l8db.query-history")).toBe(true);
  expect(shares.get("ora1")?.areas.has("l8db.db-selection")).toBe(true);
  expect(shares.get("ora2")?.areas.has("l8db.object-drafts")).toBe(true);
  expect(shares.get("deleted")?.areas.has("l8db.table-tabs")).toBe(true);
  expect([...shares.values()].some((share) => share.areas.has("l8db.connections"))).toBe(false);
  expect(storageAreas(entries)[0].label).toBe("Tabs");
});

test("removes one connection's data and keeps every other connection", () => {
  const entries = new Map(realisticEntries());
  const next = withoutConnection(
    "l8db.table-tabs",
    entries.get("l8db.table-tabs") ?? "",
    "ora1",
    ids,
  );
  expect(next).not.toBeNull();
  const state = JSON.parse(next ?? "{}").state;
  expect(state.tabsByConnection.ora1).toBeUndefined();
  expect(state.tabsByConnection.ora2).toHaveLength(6);
  expect(
    state.recentlyClosed.some(
      (tab: { closedConnectionId: string }) => tab.closedConnectionId === "ora1",
    ),
  ).toBe(false);
  expect(state.recentlyClosed).toHaveLength(83);
  expect(
    withoutConnection("l8db.settings", entries.get("l8db.settings") ?? "", "ora1", ids),
  ).toBeNull();
  const drafts = withoutConnection(
    "l8db.object-drafts",
    entries.get("l8db.object-drafts") ?? "",
    "ora2",
    ids,
  );
  expect(JSON.parse(drafts ?? "{}").state.drafts).toEqual({});
  const split = JSON.stringify({
    state: { groups: { s: [{ tabs: [{ connectionId: "ora1" }, null] }] } },
  });
  expect(withoutConnection("l8db.split-view", split, "ora1", ids)).toBeNull();
});

test("formats sizes for the storage overview", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1536)).toBe("1,5 KB");
  expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
  expect(storageLabel("l8db.storage.backup:l8db.table-tabs")).toBe("Sicherung: Tabs");
  expect(storageLabel("l8db.new-feature-seen:0.9.1:settings.general.workspace-tab")).toBe(
    "Neu-Markierungen",
  );
  expect(storageLabel("l8db.discovery.usage")).toBe("Entdecken");
  expect(storageLabel("l8db.secret-edits")).toBe("Passwort-Änderungen");
});

test("storage overview of ~11 MB (5.5M chars) across 7 connections stays interactive", async () => {
  const entries = realisticEntries();
  const chars = entries.reduce((sum, [key, value]) => sum + key.length + value.length, 0);
  let shares = new Map();
  const timing = await measureScenario(() => {
    shares = connectionShares(entries, ids);
    storageAreas(entries);
  });
  const removal = await measureScenario(() => {
    withoutConnection(entries[0][0], entries[0][1], "ora3", ids);
  });
  expect(chars).toBeGreaterThan(5_000_000);
  expect(shares.size).toBe(7);
  expect(timing.p95Ms).toBeLessThan(60);
  expect(removal.p95Ms).toBeLessThan(60);
  await reportScenario("storage-usage-overview", {
    ...timing,
    removalMedianMs: removal.medianMs,
    removalP95Ms: removal.p95Ms,
    chars,
    connections: shares.size,
    databaseRequests: 0,
    limits: { p95Ms: 60, removalP95Ms: 60 },
  });
});

import { afterAll, expect, mock, test } from "bun:test";
import type { SavedConnection } from "../src/lib/connections";
import type { BranchingLocal, ScheduleEntry } from "../src/lib/db";

const db = { ...(await import("../src/lib/db")) };
const local: BranchingLocal[] = [];
const snapshots: unknown[] = [];
const entry = (key: string, connectionId: string): ScheduleEntry => ({
  key,
  server: "pg:1",
  database: key,
  schedule: { everyHours: 24, keep: 7, connectionId, lastRunAt: null },
});

mock.module("../src/lib/db", () => ({
  ...db,
  branchingSchedules: async () => [entry("pg:1/gone", "missing"), entry("pg:1/locked", "pw")],
  branchingLocal: async (request: BranchingLocal) => {
    local.push(request);
  },
  branchingSnapshot: async (...args: unknown[]) => {
    snapshots.push(args);
  },
}));
afterAll(() => mock.module("../src/lib/db", () => db));

const { useConnectionsStore } = await import("../src/lib/connections");
const { runDueSnapshots } = await import("../src/lib/branching/scheduler");

test("übersprungene geplante Sicherungen hinterlassen einen sichtbaren Grund", async () => {
  useConnectionsStore.setState({
    connections: [
      {
        id: "pw",
        name: "PW",
        kind: "postgres",
        connectionString: "postgresql://alice@localhost:5432/app",
      } as SavedConnection,
    ],
  });
  await runDueSnapshots(Date.parse("2026-03-01T12:00:00Z"));
  expect(snapshots).toEqual([]);
  expect(local.map((request) => request.action === "schedule_skipped" && request.key)).toEqual([
    "pg:1/gone",
    "pg:1/locked",
  ]);
  expect(local.map((request) => request.action === "schedule_skipped" && request.reason)).toEqual([
    expect.stringContaining("existiert nicht mehr"),
    expect.stringContaining("Passworteingabe"),
  ]);
});

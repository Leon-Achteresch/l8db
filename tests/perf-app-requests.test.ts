import { expect, test } from "bun:test";
import { interactionPercentiles } from "./fixtures/perf-app-interactions";
import { requestCounts, requestsSince } from "./fixtures/perf-app-requests";

test("database request measurement separates metadata and execution from local polling", () => {
  expect(
    requestCounts([
      "list_tables",
      "list_tables",
      "list_all_columns",
      "execute_query",
      "mcp_take_open_requests",
      "mcp_dashboards",
      "automation_ai_activity",
      "branching_schedules",
      "plugin:dialog|open",
      "plugin:dialog|save",
      "plugin:fs|read_text_file",
      "plugin:fs|write_text_file",
    ]),
  ).toEqual({
    database: { list_tables: 2, list_all_columns: 1, execute_query: 1 },
    ipc: {
      mcp_take_open_requests: 1,
      mcp_dashboards: 1,
      automation_ai_activity: 1,
      branching_schedules: 1,
      "plugin:dialog|open": 1,
      "plugin:dialog|save": 1,
      "plugin:fs|read_text_file": 1,
      "plugin:fs|write_text_file": 1,
    },
    unknown: {},
    databaseRequests: 4,
    ipcRequests: 8,
    unknownRequests: 0,
  });
});

test("unclassified commands remain visible instead of disappearing from database gates", () => {
  expect(requestCounts(["new_database_command", "new_database_command"])).toEqual({
    database: {},
    ipc: {},
    unknown: { new_database_command: 2 },
    databaseRequests: 0,
    ipcRequests: 0,
    unknownRequests: 2,
  });
});

test("idle counters start after user interactions and retain only the fresh interval", () => {
  const before = {
    calls: ["list_tables", "mcp_take_open_requests", "execute_query"],
    activeDatabaseRequests: 0,
    maxDatabaseConcurrency: 1,
  };
  const after = {
    ...before,
    calls: [...before.calls, "mcp_take_open_requests", "mcp_dashboards"],
  };
  expect(requestsSince(before, after)).toEqual({
    database: {},
    ipc: { mcp_take_open_requests: 1, mcp_dashboards: 1 },
    unknown: {},
    databaseRequests: 0,
    ipcRequests: 2,
    unknownRequests: 0,
  });
});

test("interaction percentiles retain raw samples and choose the p95 tail", () => {
  const samples = [9, 3, 8, 1, 7, 4, 2, 6, 5];
  expect(interactionPercentiles(samples)).toEqual({
    samples,
    runs: 9,
    medianMs: 5,
    p95Ms: 9,
    maxMs: 9,
  });
  expect(samples).toEqual([9, 3, 8, 1, 7, 4, 2, 6, 5]);
});

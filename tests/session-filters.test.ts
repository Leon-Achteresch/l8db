import { describe, expect, test } from "bun:test";

import type { SessionInfo } from "../src/lib/db";
import {
  computeBlocking,
  EMPTY_SESSION_FILTERS,
  filterSessions,
  groupSessions,
  isSessionFilterActive,
  sessionStates,
} from "../src/lib/session-filters";

function session(partial: Partial<SessionInfo> & { pid: number }): SessionInfo {
  return {
    user: "app",
    database: "db",
    application: "psql",
    client_addr: null,
    state: "idle",
    query: "",
    query_start: null,
    transaction_start: null,
    wait_event: null,
    is_self: false,
    blocked_by: [],
    ...partial,
  };
}

const sessions = [
  session({
    pid: 1,
    user: "alice",
    application: "psql",
    state: "active",
    query: "SELECT 1",
  }),
  session({
    pid: 2,
    user: "bob",
    application: "pgAdmin",
    state: "idle",
    query: "UPDATE t",
  }),
  session({
    pid: 3,
    user: "alice",
    application: "",
    state: null,
    query: "select * from t",
  }),
];

describe("filterSessions", () => {
  test("empty filters return everything", () => {
    expect(filterSessions(sessions, EMPTY_SESSION_FILTERS)).toHaveLength(3);
    expect(isSessionFilterActive(EMPTY_SESSION_FILTERS)).toBe(false);
  });

  test("user filter is case-insensitive substring", () => {
    const result = filterSessions(sessions, {
      ...EMPTY_SESSION_FILTERS,
      user: "ALI",
    });
    expect(result.map((s) => s.pid)).toEqual([1, 3]);
    expect(
      isSessionFilterActive({ ...EMPTY_SESSION_FILTERS, user: "ALI" }),
    ).toBe(true);
  });

  test("state filter matches exactly and combines with query text", () => {
    expect(
      filterSessions(sessions, {
        ...EMPTY_SESSION_FILTERS,
        state: "active",
      }).map((s) => s.pid),
    ).toEqual([1]);
    expect(
      filterSessions(sessions, {
        ...EMPTY_SESSION_FILTERS,
        query: "select",
        user: "alice",
      }).map((s) => s.pid),
    ).toEqual([1, 3]);
  });

  test("application filter", () => {
    expect(
      filterSessions(sessions, {
        ...EMPTY_SESSION_FILTERS,
        application: "admin",
      }).map((s) => s.pid),
    ).toEqual([2]);
  });

  test("sessionStates lists distinct sorted non-null states", () => {
    expect(sessionStates(sessions)).toEqual(["active", "idle"]);
  });
});

describe("groupSessions", () => {
  test("none yields single group with all sessions", () => {
    const groups = groupSessions(sessions, "none");
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(3);
  });

  test("user grouping sorts by name and counts", () => {
    const groups = groupSessions(sessions, "user");
    expect(groups.map((g) => [g.label, g.sessions.length])).toEqual([
      ["alice", 2],
      ["bob", 1],
    ]);
  });

  test("application grouping puts empty app last with label", () => {
    const groups = groupSessions(sessions, "application");
    expect(groups.map((g) => g.label)).toEqual(["pgAdmin", "psql", "(leer)"]);
    expect(groups[2].key).toBe("");
  });

  test("filters apply before grouping", () => {
    const groups = groupSessions(
      filterSessions(sessions, { ...EMPTY_SESSION_FILTERS, state: "idle" }),
      "user",
    );
    expect(groups.map((g) => g.label)).toEqual(["bob"]);
  });
});

describe("computeBlocking", () => {
  test("links blocked and blocking sessions with multiple blockers", () => {
    const list = [
      session({ pid: 10 }),
      session({ pid: 11 }),
      session({ pid: 12, blocked_by: [10, 11, 11] }),
    ];
    const map = computeBlocking(list);
    expect(map.get(12)?.blockedBy).toEqual([10, 11]);
    expect(map.get(10)?.blocking).toEqual([12]);
    expect(map.get(11)?.blocking).toEqual([12]);
    expect(map.get(12)?.missingBlockers).toEqual([]);
  });

  test("marks blockers that are no longer in the session list", () => {
    const map = computeBlocking([session({ pid: 20, blocked_by: [99, 20] })]);
    expect(map.get(20)?.blockedBy).toEqual([99]);
    expect(map.get(20)?.missingBlockers).toEqual([99]);
    expect(map.has(99)).toBe(false);
  });

  test("no blocking yields empty map", () => {
    expect(computeBlocking(sessions).size).toBe(0);
  });
});

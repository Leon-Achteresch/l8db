import { expect, test } from "bun:test";
import {
  effectiveRules,
  invalidRules,
  setRule,
  suggestedRules,
  uncovered,
} from "../src/lib/branching/masking";
import {
  branchTree,
  branchUrl,
  compareChoices,
  expiryText,
  isExpired,
  suggestBranchName,
  validBranchName,
} from "../src/lib/branching/model";
import { dueSchedules } from "../src/lib/branching/scheduler";
import type { BranchingDatabase, MaskColumn, ScheduleEntry, SnapshotInfo } from "../src/lib/db";

function database(
  name: string,
  parent?: string,
  kind = "full",
  createdAt = "2026-01-01T00:00:00Z",
) {
  return {
    name,
    owner: "app",
    size: 1,
    sessions: 0,
    ownSessions: 0,
    allowConnections: true,
    canConnect: true,
    isOwner: true,
    marker: parent
      ? {
          branch: {
            id: name,
            parent,
            kind,
            method: "clone",
            status: "ready",
            createdAt,
            createdBy: "dev",
            protected: false,
            private: true,
          },
        }
      : null,
  } satisfies BranchingDatabase;
}

function column(name: string, extra: Partial<MaskColumn> = {}): MaskColumn {
  return {
    schema: "public",
    table: "customers",
    column: name,
    dataType: "text",
    category: "text",
    maxLength: null,
    notNull: false,
    generated: false,
    rootSchema: "public",
    rootTable: "customers",
    pii: null,
    ...extra,
  };
}

test("the branch tree nests branches under their parents and keeps disposable states last", () => {
  const rows = branchTree(
    [
      database("shop"),
      database("shop_old", "shop", "previous", "2026-01-01T00:00:00Z"),
      database("feature", "shop", "full", "2026-02-01T00:00:00Z"),
      database("nested", "feature", "schema"),
      database("other"),
      database("loop", "loop"),
    ],
    "shop",
  );
  expect(rows.map((row) => [row.database.name, row.depth])).toEqual([
    ["shop", 0],
    ["feature", 1],
    ["nested", 2],
    ["shop_old", 1],
  ]);
  expect(rows.find((row) => row.database.name === "shop_old")?.last).toBe(true);
});

test("branch names follow PostgreSQL-safe rules and suggestions avoid taken names", () => {
  expect(validBranchName("shop_dev")).toBeNull();
  expect(validBranchName("Shop")).not.toBeNull();
  expect(validBranchName("1shop")).not.toBeNull();
  expect(validBranchName("a".repeat(64))).not.toBeNull();
  expect(suggestBranchName("Shop-DB", ["shop-db_dev"])).toBe("shop-db_dev2");
  expect(suggestBranchName("42", [])).toBe("branch_dev");
});

test("branch URLs never carry the password", () => {
  const url = branchUrl("postgresql://app:geheim@db.example:5432/shop?sslmode=require", "shop dev");
  expect(url).toBe("postgresql://app@db.example:5432/shop%20dev?sslmode=require");
  expect(branchUrl("kein url", "x")).toBeNull();
});

test("expiry is evaluated against the given clock", () => {
  const now = Date.parse("2026-03-01T12:00:00Z");
  expect(isExpired("2026-03-01T11:59:00Z", now)).toBe(true);
  expect(isExpired("2026-03-02T12:00:00Z", now)).toBe(false);
  expect(isExpired(null, now)).toBe(false);
  expect(expiryText("2026-03-01T11:00:00Z", now)).toBe("abgelaufen");
  expect(expiryText("2026-03-02T12:00:00Z", now)).toStartWith("läuft");
});

test("schema comparisons offer live states and intact snapshots only", () => {
  const snapshots = [
    {
      id: "a",
      database: "shop",
      label: "vorher",
      createdAt: "2026-01-01T00:00:00Z",
      problem: null,
    },
    { id: "b", database: "", label: "", createdAt: "", problem: "Signatur ungültig" },
  ] as SnapshotInfo[];
  const keys = compareChoices(
    [database("shop"), database("shop_l8db_1", "shop", "staging"), database("feature", "shop")],
    snapshots,
  ).map((choice) => choice.key);
  expect(keys).toEqual(["live:shop", "live:feature", "snapshot:a"]);
});

test("masking coverage flags detected personal data without a rule", () => {
  const columns = [
    column("email", { pii: { reason: "E-Mail-Adresse", strategy: "email" } }),
    column("phone", { pii: { reason: "Telefonnummer", strategy: "phone" } }),
    column("note"),
    column("email", {
      table: "customers_2026",
      rootTable: "customers",
      pii: { reason: "E-Mail-Adresse", strategy: "email" },
    }),
    column("search", { generated: true, pii: { reason: "E-Mail-Adresse", strategy: "email" } }),
  ];
  const rules = setRule([], { schema: "public", table: "customers", column: "email" }, "email");
  expect(uncovered(columns, rules).map((entry) => entry.column)).toEqual(["phone"]);
  const suggested = suggestedRules(columns, rules);
  expect(suggested.map((rule) => `${rule.column}:${rule.strategy}`)).toEqual([
    "email:email",
    "phone:phone",
  ]);
  expect(uncovered(columns, suggested)).toEqual([]);
});

test("invalid masking rules are rejected before they reach the database", () => {
  const columns = [
    column("born", { category: "date", dataType: "date" }),
    column("code", { notNull: true }),
  ];
  const problems = invalidRules(columns, [
    { schema: "public", table: "customers", column: "born", strategy: "email" },
    { schema: "public", table: "customers", column: "code", strategy: "null" },
    { schema: "public", table: "customers", column: "code", strategy: "fixed" },
    { schema: "public", table: "customers", column: "gone", strategy: "redact" },
  ]);
  expect(problems).toHaveLength(4);
  expect(problems.at(-1)).toContain("existiert nicht");
});

test("team rules win and strict databases ignore personal rules", () => {
  const team = [
    { schema: "public", table: "customers", column: "email", strategy: "hash" as const },
  ];
  const local = [
    { schema: "public", table: "customers", column: "email", strategy: "keep" as const },
    { schema: "public", table: "customers", column: "phone", strategy: "phone" as const },
  ];
  expect(effectiveRules(team, true, local)).toEqual(team);
  expect(
    effectiveRules(team, false, local).map((rule) => `${rule.column}:${rule.strategy}`),
  ).toEqual(["email:hash", "phone:phone"]);
});

test("scheduled snapshots run when due and back off after a failed attempt", () => {
  const now = Date.parse("2026-03-01T12:00:00Z");
  const entry = (key: string, lastRunAt: string | null, everyHours = 24): ScheduleEntry => ({
    key,
    server: "pg:1",
    database: key,
    schedule: { everyHours, keep: 7, connectionId: "c", lastRunAt },
  });
  const entries = [
    entry("never", null),
    entry("fresh", "2026-03-01T06:00:00Z"),
    entry("stale", "2026-02-28T11:00:00Z"),
    entry("hourly", "2026-03-01T10:59:00Z", 1),
  ];
  expect(dueSchedules(entries, now, new Map()).map((due) => due.key)).toEqual([
    "never",
    "stale",
    "hourly",
  ]);
  const recent = new Map([
    ["never", now - 10 * 60_000],
    ["stale", now - 31 * 60_000],
  ]);
  expect(dueSchedules(entries, now, recent).map((due) => due.key)).toEqual(["stale", "hourly"]);
});

import { describe, expect, test } from "bun:test";
import { fingerprintKey, fingerprintSql } from "../src/lib/versioning/fingerprint";
import { ignoreMatcher, parseIgnore, validateIgnore } from "../src/lib/versioning/ignore";
import {
  migrationScript,
  scriptName,
  scriptNames,
  terminate,
} from "../src/lib/versioning/migration-script";
import { recentCommits } from "../src/lib/versioning/overview";
import {
  DEFAULT_TICKETS,
  findTickets,
  groupChanges,
  lineHunks,
  parseTickets,
  reviewRows,
  tableChanges,
  ticketPrefix,
} from "../src/lib/versioning/review";
import type { DatabaseRelease, VersioningProject } from "../src/lib/versioning/types";

const project: VersioningProject = {
  format: 1,
  id: "p",
  name: "Shop",
  kind: "oracle",
  objects: [
    {
      id: "o",
      path: "database/objects/APP-ORDERS-table-1a2b3c4d.sql",
      selection: { schema: "APP", objectType: "table", objectName: "ORDERS", objectOid: null },
    },
    {
      id: "k",
      path: "database/objects/APP-BILLING-package-1a2b3c4d.pks",
      bodyPath: "database/objects/APP-BILLING-package-1a2b3c4d.pkb",
      selection: { schema: "APP", objectType: "package", objectName: "BILLING", objectOid: null },
    },
  ],
};

describe("database view of changed files", () => {
  test("maps files to tables, packages, releases and team files", () => {
    const groups = groupChanges(
      [
        { path: "database/objects/APP-BILLING-package-1a2b3c4d.pkb", status: "M" },
        { path: "database/releases/v2.json", status: "A" },
        { path: "database/objects/APP-ORDERS-table-1a2b3c4d.sql", status: "M" },
        { path: "database/team.json", status: "M" },
        { path: "database/objects/APP-V_SALES-view-99999999.sql", status: "A" },
        { path: "database/notes.md", status: "A" },
      ],
      project,
    );
    expect(
      groups.map((group) => [group.category, group.entries.map((entry) => entry.name)]),
    ).toEqual([
      ["table", ["ORDERS"]],
      ["view", ["V_SALES"]],
      ["package", ["BILLING (Body)"]],
      ["release", ["v2"]],
      ["customers", ["Kunden, Umgebungen und Regeln"]],
      ["other", ["notes.md"]],
    ]);
  });

  test("summarizes table structure changes per section", () => {
    const before =
      "TABLE APP.ORDERS\nCOLUMNS\n  ID NUMBER NOT NULL\n  NOTE VARCHAR2(10) NULL\n  OLD DATE NULL\nINDEXES\n  CREATE INDEX IX_A ON ORDERS (ID)";
    const after =
      "TABLE APP.ORDERS\nCOLUMNS\n  ID NUMBER NOT NULL\n  NOTE VARCHAR2(200) NULL\n  NEW_COL DATE NULL\nINDEXES\n  CREATE INDEX IX_A ON ORDERS (ID)\n  CREATE UNIQUE INDEX IX_B ON ORDERS (NOTE)";
    expect(tableChanges(before, after)).toEqual([
      { section: "Spalten", added: ["NEW_COL"], removed: ["OLD"], changed: ["NOTE"] },
      { section: "Indizes", added: ["IX_B"], removed: [], changed: [] },
    ]);
    expect(tableChanges("CREATE VIEW x", "CREATE VIEW y")).toBeNull();
  });

  test("diff rows keep real file line numbers and collapse unchanged ranges", () => {
    const before = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n");
    const lines = before.split("\n");
    lines[14] = "changed 15";
    const rows = reviewRows(`${before}\n`, `${lines.join("\n")}\n`);
    expect(rows[0]).toEqual({ kind: "gap", hidden: 11, from: 1 });
    expect(rows.find((row) => row.kind === "remove")).toEqual({
      kind: "remove",
      old: 15,
      new: null,
      text: "line 15",
    });
    expect(rows.find((row) => row.kind === "add")).toEqual({
      kind: "add",
      old: null,
      new: 15,
      text: "changed 15",
    });
    expect(rows.at(-1)).toEqual({ kind: "gap", hidden: 12, from: 19 });
    expect(reviewRows("", "a\nb")).toHaveLength(2);
  });
});

test("large diffs stay line-accurate through unique anchors", () => {
  const left = Array.from({ length: 3000 }, (_, index) => `row ${index}`);
  const right = [...left];
  right.splice(10, 1, "changed a", "inserted");
  right.splice(2500, 2);
  right.push("tail");
  const rebuilt = [...left];
  for (const hunk of [...lineHunks(left, right)].reverse())
    rebuilt.splice(hunk.oldStart - 1, hunk.oldLines.length, ...hunk.newLines);
  expect(rebuilt).toEqual(right);
  expect(lineHunks(left, right).length).toBeLessThan(6);
});

describe("tickets", () => {
  test("detects keys from any tracker and builds links", () => {
    const configuration = parseTickets(
      JSON.stringify({
        format: 1,
        trackers: [
          {
            id: "jira",
            label: "Jira",
            pattern: "[A-Z][A-Z0-9_]+-\\d+",
            url: "https://acme.atlassian.net/browse/{key}",
          },
          {
            id: "azure",
            label: "Azure Boards",
            pattern: "AB#(\\d+)",
            url: "https://dev.azure.com/acme/shop/_workitems/edit/{id}",
          },
        ],
      }),
    );
    const found = findTickets(
      ["feature/SHOP-142-rabatt", "Fix AB#77 und SHOP-142, nicht XSHOP-1x"],
      configuration,
    );
    expect(found).toEqual([
      { key: "SHOP-142", tracker: "Jira", url: "https://acme.atlassian.net/browse/SHOP-142" },
      {
        key: "AB#77",
        tracker: "Azure Boards",
        url: "https://dev.azure.com/acme/shop/_workitems/edit/77",
      },
    ]);
    expect(ticketPrefix("Rabatt", found)).toBe("SHOP-142 AB#77: Rabatt");
    expect(ticketPrefix("SHOP-142: Rabatt", found.slice(0, 1))).toBe("SHOP-142: Rabatt");
    expect(findTickets(["ABC-1"], DEFAULT_TICKETS)[0].url).toBeNull();
  });

  test("rejects unsafe links and broken patterns", () => {
    const invalid = (tracker: Record<string, string>) => () =>
      parseTickets(
        JSON.stringify({
          format: 1,
          trackers: [{ id: "x", label: "X", pattern: "A-\\d+", url: "", ...tracker }],
        }),
      );
    expect(invalid({ url: "http://tickets.example/{key}" })).toThrow();
    expect(invalid({ url: "https://tickets.example/" })).toThrow();
    expect(invalid({ pattern: "(" })).toThrow();
    expect(invalid({})).not.toThrow();
  });
});

describe("ignore list", () => {
  test("matches globs with optional object type", () => {
    const ignored = ignoreMatcher(
      parseIgnore(JSON.stringify({ format: 1, patterns: ["view:V_EXP_*", "TMP_?"] })),
    );
    expect(ignored("view", "V_EXP_SALES")).toBe(true);
    expect(ignored("table", "V_EXP_SALES")).toBe(false);
    expect(ignored("routine", "TMP_1(integer)")).toBe(true);
    expect(ignored("table", "TMP_12")).toBe(false);
    expect(() => validateIgnore({ format: 1, patterns: ["index:X"] })).toThrow();
    expect(parseIgnore(null).patterns).toEqual([]);
  });
});

describe("migration scripts", () => {
  const release = (id: string, kind: "oracle" | "postgres"): DatabaseRelease => ({
    format: 1,
    id,
    projectId: "p",
    kind,
    parent: null,
    createdAt: "2026-10-01T00:00:00Z",
    objects: [],
    migrations: [{ id: "m", title: "Spalte NOTE", sql: "", checksum: "" }],
  });
  test("terminates Oracle PL/SQL blocks with a slash and plain SQL with a semicolon", () => {
    expect(terminate("oracle", "CREATE OR REPLACE PACKAGE BODY X AS BEGIN NULL; END X;")).toBe(
      "CREATE OR REPLACE PACKAGE BODY X AS BEGIN NULL; END X;\n/",
    );
    expect(terminate("oracle", "ALTER TABLE X ADD (Y NUMBER)")).toBe(
      "ALTER TABLE X ADD (Y NUMBER);",
    );
    expect(terminate("postgres", "ALTER TABLE x ADD y int;")).toBe("ALTER TABLE x ADD y int;");
  });
  test("writes a reviewable script per target", () => {
    const plan = {
      target: {
        id: "t",
        name: "Kunde A Live",
        customer: "Kunde A",
        environment: "Live",
        production: true,
        connectionId: "c",
        database: null,
        schema: "APP",
        history: [],
      },
      from: release("v1", "postgres"),
      to: release("v2", "postgres"),
      reference: { id: "v2", commit: "a".repeat(40), path: "database/releases/v2.json" },
      releases: [release("v2", "postgres")],
      sql: ["ALTER TABLE app.orders ADD note text"],
    };
    const script = migrationScript(plan, "Shop", new Date("2026-10-13T00:00:00Z"));
    expect(script).toContain("-- Ziel: Kunde A · Live · Kunde A Live");
    expect(script).toContain("BEGIN;\n");
    expect(script).toContain("ALTER TABLE app.orders ADD note text;\n");
    expect(script.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(scriptName(plan)).toBe("migration-Kunde_A-Live-Kunde_A_Live-v1-v2.sql");
    expect(scriptNames([plan, plan])).toEqual([
      "migration-Kunde_A-Live-Kunde_A_Live-v1-v2.sql",
      "migration-Kunde_A-Live-Kunde_A_Live-v1-v2-2.sql",
    ]);
  });
});

describe("fingerprint queries", () => {
  test("page by name and escape literals", () => {
    const first = fingerprintSql("postgres", "table", "app's", null) ?? "";
    expect(first).toContain("n.nspname = 'app''s'");
    expect(first).not.toContain("> '");
    expect(fingerprintSql("postgres", "view", "app", "o'x")).toContain("> 'o''x'");
    expect(fingerprintSql("oracle", "table", "APP", null)).not.toContain("object_name >");
    expect(fingerprintSql("oracle", "package", "APP", "B")).toContain("o.object_name > 'B'");
    expect(fingerprintSql("mysql", "table", "app", null)).toBeNull();
    expect(fingerprintKey("oracle", "routine", "CALC(NUMBER)")).toBe(
      fingerprintKey("oracle", "routine", "CALC"),
    );
    expect(fingerprintKey("postgres", "routine", "calc(integer)")).not.toBe(
      fingerprintKey("postgres", "routine", "calc(text)"),
    );
  });
});

test("recent commits keep tabs inside subjects", () => {
  expect(recentCommits("a\tFix\tSHOP-1\nb\tInit\n", 1)).toEqual([
    { hash: "a", subject: "Fix\tSHOP-1" },
  ]);
});

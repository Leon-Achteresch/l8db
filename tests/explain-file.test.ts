import { describe, expect, test } from "bun:test";

import type { ExplainNode } from "../src/lib/db";
import {
  buildSavedExplainPlan,
  defaultExplainFileName,
  EXPLAIN_FILE_KIND,
  EXPLAIN_FILE_VERSION,
  formatCapturedAt,
  parseExplainPlanFile,
  serializeExplainPlan,
} from "../src/lib/explain-file";

const plan = {
  "Node Type": "Seq Scan",
  "Relation Name": "kunde",
  "Startup Cost": 0,
  "Total Cost": 12.5,
  "Plan Rows": 100,
  "Plan Width": 32,
} as unknown as ExplainNode;

const context = {
  sql: "select * from kunde",
  connectionName: "Prod Nord",
  databaseKind: "postgres",
  database: "shop",
  analyzed: false,
  capturedAt: new Date("2026-02-03T10:20:30.000Z"),
};

describe("buildSavedExplainPlan", () => {
  test("übernimmt Kontext und Modus", () => {
    const saved = buildSavedExplainPlan(plan, context);
    expect(saved.kind).toBe(EXPLAIN_FILE_KIND);
    expect(saved.version).toBe(EXPLAIN_FILE_VERSION);
    expect(saved.mode).toBe("EXPLAIN");
    expect(saved.sql).toBe("select * from kunde");
    expect(saved.connectionName).toBe("Prod Nord");
    expect(saved.database).toBe("shop");
    expect(saved.capturedAt).toBe("2026-02-03T10:20:30.000Z");
  });

  test("markiert ANALYZE", () => {
    expect(buildSavedExplainPlan(plan, { ...context, analyzed: true }).mode).toBe("ANALYZE");
  });

  test("entfernt Secret-Felder aus dem Plan", () => {
    const dirty = {
      ...plan,
      password: "geheim",
      Plans: [{ ...plan, connectionString: "postgres://u:p@host/db" }],
    } as unknown as ExplainNode;
    const saved = buildSavedExplainPlan(dirty, context);
    const json = serializeExplainPlan(saved);
    expect(json).not.toContain("geheim");
    expect(json).not.toContain("postgres://");
  });

  test("ohne Datenbank wird null gespeichert", () => {
    expect(buildSavedExplainPlan(plan, { ...context, database: undefined }).database).toBeNull();
  });
});

describe("parseExplainPlanFile", () => {
  test("Roundtrip", () => {
    const saved = buildSavedExplainPlan(plan, context);
    const parsed = parseExplainPlanFile(serializeExplainPlan(saved));
    expect(parsed).toEqual(saved);
  });

  test("ungültiges JSON", () => {
    expect(() => parseExplainPlanFile("{ nope")).toThrow(/kein gültiges JSON/);
  });

  test("fremde Datei", () => {
    expect(() => parseExplainPlanFile(JSON.stringify({ foo: 1 }))).toThrow(/keine l8db-Plandatei/);
  });

  test("zu neue Version", () => {
    const saved = { ...buildSavedExplainPlan(plan, context), version: 99 };
    expect(() => parseExplainPlanFile(JSON.stringify(saved))).toThrow(/Unbekannte Dateiversion 99/);
  });

  test("ungültiger Modus", () => {
    const saved = { ...buildSavedExplainPlan(plan, context), mode: "GUESS" };
    expect(() => parseExplainPlanFile(JSON.stringify(saved))).toThrow(/Ungültiger Modus/);
  });

  test("ungültiger Plan ohne Node Type", () => {
    const saved = { ...buildSavedExplainPlan(plan, context), plan: { foo: 1 } };
    expect(() => parseExplainPlanFile(JSON.stringify(saved))).toThrow(/Node Type/);
  });

  test("ungültiger Kindknoten", () => {
    const saved = buildSavedExplainPlan(
      { ...plan, Plans: [{ foo: 1 }] } as unknown as ExplainNode,
      context,
    );
    expect(() => parseExplainPlanFile(JSON.stringify(saved))).toThrow(/plan\.Plans\[0\]/);
  });

  test("fehlendes SQL", () => {
    const saved = { ...buildSavedExplainPlan(plan, context), sql: undefined };
    expect(() => parseExplainPlanFile(JSON.stringify(saved))).toThrow(/SQL-Text fehlt/);
  });
});

describe("defaultExplainFileName", () => {
  test("enthält Verbindung, Modus und Zeitstempel", () => {
    const name = defaultExplainFileName({
      connectionName: "Prod Nord",
      analyzed: true,
      capturedAt: new Date(2026, 1, 3, 10, 20, 30),
    });
    expect(name).toBe("prod-nord-analyze-20260203-102030.l8plan.json");
  });

  test("ohne Namen Fallback", () => {
    const name = defaultExplainFileName({
      analyzed: false,
      capturedAt: new Date(2026, 1, 3, 1, 2, 3),
    });
    expect(name).toBe("plan-explain-20260203-010203.l8plan.json");
  });
});

describe("formatCapturedAt", () => {
  test("leerer Wert", () => {
    expect(formatCapturedAt("")).toBe("unbekannt");
  });

  test("unparsbarer Wert bleibt erhalten", () => {
    expect(formatCapturedAt("gestern")).toBe("gestern");
  });
});

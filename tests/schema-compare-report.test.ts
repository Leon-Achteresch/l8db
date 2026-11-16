import { expect, test } from "bun:test";
import { defaultSelection } from "../src/lib/schema-compare/diff";
import { buildSchemaChangeReport, MAX_REPORT_ITEMS } from "../src/lib/schema-compare/report";
import { buildSyncScript } from "../src/lib/schema-compare/script";
import { reportItem, reportResult } from "./fixtures/schema-report";

test("readable report preserves desired direction, values and destructive/blocked differences without executing or including SQL", () => {
  const changed = reportItem();
  changed.blocked = "Abhängigkeit fehlt";
  const added = { ...reportItem("new_field"), status: "only_source" as const, target: null };
  const removed = { ...reportItem("old_field"), status: "only_target" as const, source: null };
  const result = reportResult([changed, added, removed]);
  const script = buildSyncScript(result, {
    ...defaultSelection(result.items),
    [removed.key]: true,
  });
  const report = buildSchemaChangeReport(result, script);
  expect(report).toContain('Ziel ` "prod" ` an Quelle ` "dev" ` angleichen');
  expect(report).toContain('Datentyp: Ziel ` "numeric(8,2)" ` → Quelle ` "numeric(12,2)" `');
  expect(report).toContain("**Fehlt im Ziel:**");
  expect(report).toContain("**Nur im Ziel:**");
  expect(report).toContain("bewusste Umbenennung");
  expect(report).not.toContain("Angleichen würde dieses Zielobjekt entfernen");
  expect(report).toContain("Potenziell destruktiv");
  expect(report).toContain("Synchronisation gesperrt");
  expect(report).toContain("im aktuellen ausgewählten SQL-Plan".replace("im", "Im"));
  expect(report).toContain("Keine Migration ausgeführt oder bestätigt");
  expect(report).toContain("3 abweichende Einträge");
  for (const step of script.statements) expect(report).not.toContain(step.sql);
});

test("no changes, missing scope and omissions never assert global equality", () => {
  const result = reportResult([]);
  const empty = { statements: [], warnings: [] };
  expect(buildSchemaChangeReport(result, empty)).toContain(
    "Keine Unterschiede im erfassten Umfang",
  );
  result.omitted = 5;
  result.tableScope = { source: ["orders"], target: [] };
  let report = buildSchemaChangeReport(result, empty);
  expect(report).toContain("UNVOLLSTÄNDIG");
  expect(report).toContain("ausgelassene Unterschiede: 5");
  expect(report).toContain('Tabellenumfang Quelle: ` "orders" `');
  expect(report).toContain("leere Tabellenliste");
  result.omitted = undefined;
  result.tableScope = undefined;
  report = buildSchemaChangeReport(result, empty);
  expect(report).toContain("ausgelassene Unterschiede: unbekannt");
  expect(report).toContain("unbekannt (älterer Vergleich)");
  expect(report).not.toContain("Keine Unterschiede im erfassten Umfang");
});

test("snapshot, ignored rules, missing types and partial script choice are explicit", () => {
  const result = reportResult();
  result.snapshotTimes = { source: null, target: "2026-10-01T10:00:00Z" };
  result.target.snapshot = {
    path: "/private/path/prod.json",
    kind: "postgres",
    connectionName: "Snapshot",
    createdAt: "2025-01-01T00:00:00Z",
  };
  result.options.excludePatterns = "archive_%";
  const report = buildSchemaChangeReport(result, {
    statements: [],
    warnings: ["Keine Anweisung erzeugt"],
  });
  expect(report).toContain("Snapshot vom");
  expect(report).not.toContain("/private/path/");
  expect(report).toContain("2026-10-01T10:00:00Z");
  expect(report).not.toContain("2025-01-01T00:00:00Z");
  expect(report).toContain("Nicht verglichen");
  expect(report).toContain("Indizes");
  expect(report).toContain("Spaltenreihenfolge");
  expect(report).toContain("archive_%");
  expect(report).toContain("Skriptauswahl begrenzen diesen Bericht nicht");
  expect(report).toContain("0 vorbereitete Anweisungen");
  expect(report).toContain("nicht als sicher bewertet");
});

test("untrusted names cannot break their Markdown code spans or add new report lines", () => {
  const name = "a```\n# Fake\n[x](javascript:bad)<script>alert(1)</script>\u202e";
  const result = reportResult([reportItem(name)]);
  const report = buildSchemaChangeReport(result, { statements: [], warnings: [] });
  expect(report).toContain(
    '```` "a```\\n# Fake\\n[x](javascript:bad)<script>alert(1)</script>\\u202e" ````',
  );
  expect(report).not.toContain("\n# Fake");
  expect(report).not.toContain("\u202e");
});

test("oversized reports fail explicitly instead of silently dropping differences", () => {
  const result = reportResult();
  result.items = Array(MAX_REPORT_ITEMS + 1).fill(reportItem());
  expect(() => buildSchemaChangeReport(result, { statements: [], warnings: [] })).toThrow(
    "Zu viele",
  );
  const base = reportItem();
  result.items = Array.from({ length: 600 }, (_, index) => ({
    ...base,
    name: `${index}${"x".repeat(8000)}`,
  }));
  expect(() => buildSchemaChangeReport(result, { statements: [], warnings: [] })).toThrow(
    "Bericht zu groß",
  );
  result.items = [reportItem("x".repeat(16_385))];
  expect(() => buildSchemaChangeReport(result, { statements: [], warnings: [] })).toThrow(
    "zu lang",
  );
});

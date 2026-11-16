import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CsvImportValidation } from "../src/features/import/csv-import-validation";
import { validateMappings } from "../src/lib/csv-import";

const targets = [
  {
    name: "email",
    data_type: "text",
    is_nullable: false,
    has_default: false,
    is_identity: false,
    is_generated: false,
  },
];

test("import report shows checked scope, total errors and omitted detail count", () => {
  const issues = validateMappings(
    [{ csvIndex: 0, target: "email" }],
    targets,
    Array.from({ length: 23 }, () => [null]),
  );
  const html = renderToStaticMarkup(createElement(CsvImportValidation, { issues }));
  expect(html).toContain("Zuordnung / NULL-Prüfung");
  expect(html).toContain("23 geladene Datensätze");
  expect(html).toContain("23 Fehler");
  expect(html).toContain("13 weitere Fehler");
  expect((html.match(/<li /g) ?? []).length).toBe(11);
});

test("clean report names only loaded data and preserves existing warnings", () => {
  const issues = validateMappings([{ csvIndex: 0, target: "email" }], targets, [["ok"]]);
  issues.warnings.push("Eine bestehende Warnung");
  const html = renderToStaticMarkup(createElement(CsvImportValidation, { issues }));
  expect(html).toContain("1 geladene Datensätze");
  expect(html).toContain("0 Fehler");
  expect(html).toContain("Eine bestehende Warnung");
  expect(html).not.toContain("weitere Fehler");
  expect(html).not.toContain("Import erfolgreich");
});

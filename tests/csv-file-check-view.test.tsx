import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CsvFileCheck } from "../src/features/import/csv-file-check";
import type { CsvCheckReport } from "../src/lib/db/csv-check";

const report: CsvCheckReport = {
  status: "complete",
  checked_rows: 20_000,
  error_count: 0,
  issues: [],
  source_size: 200,
  source_modified_ms: 1234,
};
function render(value: CsvCheckReport) {
  return renderToStaticMarkup(
    createElement(CsvFileCheck, {
      importing: false,
      check: {
        canCheck: true,
        checking: false,
        report: value,
        error: null,
        run: async () => {},
        cancel: () => {},
        invalidate: () => {},
      },
    }),
  );
}
test("successful CSV check names scope and server exclusions", () => {
  const html = render(report);
  expect(html).toContain("20.000 Datensätze vollständig gelesen");
  expect(html).toContain("Keine Struktur-/NULL-Fehler");
  expect(html).toContain("Serverregeln nicht geprüft");
  expect(html).not.toContain("Import erfolgreich");
});
test("cancelled, changed and incomplete checks never display clean approval", () => {
  for (const status of ["cancelled", "changed", "incomplete"] as const) {
    const html = render({ ...report, status });
    expect(html).not.toContain("Keine Struktur-/NULL-Fehler");
  }
});

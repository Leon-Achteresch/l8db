import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CsvFileCheck } from "../src/features/import/csv-file-check";
import type { CsvCheckState } from "../src/lib/csv-file-check";
import type { CsvCheckReport } from "../src/lib/db/csv-check";

const report: CsvCheckReport = {
  status: "complete",
  checked_rows: 20_000,
  error_count: 0,
  issues: [],
  source_size: 200,
  source_modified_ms: 1234,
};
const idle: CsvCheckState = {
  checkedRows: null,
  checking: false,
  cancelling: false,
  cancelled: false,
  report: null,
  error: null,
};

function render(
  state: Partial<CsvCheckState>,
  options: { canCheck?: boolean; pick?: boolean } = {},
) {
  return renderToStaticMarkup(
    createElement(CsvFileCheck, {
      importing: false,
      onPickFile: options.pick === false ? undefined : () => {},
      check: {
        ...idle,
        ...state,
        canCheck: options.canCheck ?? true,
        run: async () => {},
        cancel: () => {},
        invalidate: () => {},
      },
    }),
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("ready state names the scope and offers only the check", () => {
  const html = text(render({}));
  expect(html).toContain("Struktur und NULL · ohne Datenbankzugriff");
  expect(html).toContain("CSV-Datei prüfen");
  expect(html).not.toContain("Datei neu wählen");
  expect(render({}, { canCheck: false })).toBe("");
});

test("clean complete check names read rows, snapshot and unchecked server rules", () => {
  const html = text(render({ report }));
  expect(html).toContain("Keine Struktur- oder NULL-Befunde");
  expect(html).toContain("20.000 Datensätze gelesen · Dateistand");
  expect(html).toContain(
    "Nicht geprüft: Datentypen, Unique, Fremdschlüssel, Trigger, Serverimport",
  );
  expect(html).toContain("Erneut prüfen");
  expect(html).not.toContain("Import erfolgreich");
  expect(text(render({ report: { ...report, source_modified_ms: null } }))).toContain(
    "Dateistand unbekannt",
  );
});

test("running and requested cancellation never show an old report", () => {
  const running = text(render({ checking: true }));
  expect(running).toContain("Prüft die ganze Datei…");
  expect(running).toContain("Prüfung abbrechen");
  expect(running).not.toContain("Datensätze gelesen");
  expect(running).toContain("Datensätze unbekannt");
  expect(text(render({ checking: true, checkedRows: 0 }))).toContain("0 Datensätze gelesen");
  expect(text(render({ checking: true, cancelling: true, checkedRows: 16384 }))).toContain(
    "16.384 Datensätze gelesen",
  );
  const cancelling = render({ checking: true, cancelling: true });
  expect(text(cancelling)).toContain("Abbruch angefordert…");
  expect(cancelling).toContain('aria-disabled="true"');
});

test("cancelled, changed and incomplete checks never display clean approval", () => {
  for (const status of ["cancelled", "changed", "incomplete"] as const) {
    const html = text(render({ report: { ...report, status } }));
    expect(html).not.toContain("Keine Struktur- oder NULL-Befunde");
    expect(html).not.toContain("Nicht geprüft:");
  }
  const changed = text(render({ report: { ...report, status: "changed" } }));
  expect(changed).toContain("Ergebnis verworfen");
  expect(changed).toContain("Datei neu wählen");
  expect(changed).not.toContain("Datensätze gelesen");
  const cancelled = text(
    render({ report: { ...report, status: "cancelled", checked_rows: 8192 } }),
  );
  expect(cancelled).toContain("Abgebrochen · keine Freigabe");
  expect(cancelled).toContain("8.192 Datensätze gelesen");
  expect(text(render({ cancelled: true }))).toContain("Abgebrochen · keine Freigabe");
});

test("runner errors are separate from cancellation", () => {
  const html = text(render({ error: "Error: Datei nicht lesbar" }));
  expect(html).toContain("Prüfung fehlgeschlagen");
  expect(html).toContain("Error: Datei nicht lesbar");
  expect(html).not.toContain("Abgebrochen");
});

test("findings show exact totals, ten details, the remainder and unknown lines", () => {
  const issues: CsvCheckReport["issues"] = [
    { row: 0, line: 1, column: null, kind: "structure", message: "Kopfzeile abweichend." },
    {
      row: 9_007_199_254,
      line: 9_007_199_260,
      column: "id",
      kind: "not_null",
      message: "Darf nicht NULL sein.",
    },
    { row: 12, line: 0, column: null, kind: "parse", message: "Ungültiges Anführungszeichen." },
    ...Array.from({ length: 7 }, (_, index) => ({
      row: index + 20,
      line: index + 21,
      column: "name",
      kind: "not_null" as const,
      message: "Darf nicht NULL sein.",
    })),
  ];
  const html = render({
    report: { ...report, status: "incomplete", checked_rows: 11, error_count: 1_234_567, issues },
  });
  const plain = text(html);
  expect(plain).toContain("Unvollständig · Datei nicht bis zum Ende lesbar");
  expect(plain).toContain("11 Datensätze gelesen");
  expect(plain).toContain("Datensatz Dateizeile Befund");
  expect(plain).toContain("Kopfzeile 1");
  expect(plain).toContain("9.007.199.254 9.007.199.260 id");
  expect(plain).toContain("12 – unbekannt");
  expect(plain).toContain("+1.234.557 weitere Befunde");
  expect(plain).toContain("Erste 10 von 1.234.567 Befunden");
  expect((html.match(/<tr class="align-top">/g) ?? []).length).toBe(10);
  const findings = text(
    render({ report: { ...report, error_count: 1, issues: issues.slice(1, 2) } }),
  );
  expect(findings).toContain("1 Befund ");
  expect(findings).not.toContain("weitere");
  expect(
    text(render({ report: { ...report, error_count: 2, issues } }, { pick: false })),
  ).not.toContain("Datei neu wählen");
});

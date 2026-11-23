import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { QueryResult } from "../src/lib/db/types";
import type { ProcedureRunState } from "../src/lib/procedure-run";

let grid: { result: QueryResult; isLoading: boolean; error: string | null; kind?: string } | null =
  null;
mock.module("../src/features/query/query-result-table", () => ({
  QueryResultTable: (props: NonNullable<typeof grid>) => {
    grid = props;
    return createElement(
      "div",
      { "data-existing-result-grid": "" },
      props.result.columns.join(","),
    );
  },
}));
mock.module("../src/features/table/cell-value-dialog", () => ({ CellValueDialog: () => null }));
mock.module("../src/components/ui/dialog", () => {
  const box = ({ children, ...props }: { children?: ReactNode }) =>
    createElement("div", props, children);
  return {
    Dialog: box,
    DialogContent: box,
    DialogHeader: box,
    DialogTitle: box,
    DialogDescription: box,
    DialogFooter: box,
  };
});

let view = {
  connection: { kind: "postgres" },
  inputs: [{ name: "arg", type: "text", mode: "IN" }],
  values: { arg: "value" },
  setValue: () => {},
  statement: 'CALL "s"."p"(\'value\')',
  state: { status: "idle" } as ProcedureRunState,
  pending: false,
  handleRun: async () => {},
};
mock.module("../src/features/functions/use-procedure-run", () => ({ useProcedureRun: () => view }));
const { ProcedureRunDialog } = await import("../src/features/functions/procedure-run-dialog");
const { ProcedureRunResult } = await import("../src/features/functions/procedure-run-result");
const { ResultEmpty } = await import("../src/features/query/query-result-table/result-empty");

const result: QueryResult = {
  columns: ["total"],
  rows: [{ total: null }],
  rows_affected: null,
  execution_time_ms: 9,
};
const dialog = () =>
  renderToStaticMarkup(
    createElement(ProcedureRunDialog, {
      open: true,
      onOpenChange: () => {},
      schema: "s",
      name: "p",
      identityArgs: "arg text",
    }),
  );

test("the actual result section forwards the already returned object to the established grid", () => {
  grid = null;
  const html = renderToStaticMarkup(
    createElement(ProcedureRunResult, { result, kind: "postgres" }),
  );
  expect(grid?.result).toBe(result);
  expect(grid?.isLoading).toBe(false);
  expect(grid?.error).toBeNull();
  expect(grid?.kind).toBe("postgres");
  expect(html).toContain("1 Ergebniszeile");
  expect(html).toContain('aria-label="Prozedurergebnis"');
  expect(html).not.toContain("Anzeige begrenzt");
});

test("empty and no-rowset successes preserve truthful existing empty/affected/notice states", () => {
  const empty = { ...result, rows: [] };
  expect(
    renderToStaticMarkup(createElement(ProcedureRunResult, { result: empty, kind: "postgres" })),
  ).toContain("0 Ergebniszeilen");
  for (const [value, label] of [
    [{ ...empty, columns: [], rows_affected: null }, "Kein Ergebnis"],
    [{ ...empty, columns: [], rows_affected: 4 }, "4 Zeilen betroffen"],
    [{ ...empty, columns: [], notice: "Fertig <Hinweis>" }, "Fertig &lt;Hinweis&gt;"],
  ] as const) {
    expect(renderToStaticMarkup(createElement(ResultEmpty, { result: value }))).toContain(label);
  }
});

test("declared truncation is visible without claiming the total number of rows", () => {
  const html = renderToStaticMarkup(
    createElement(ProcedureRunResult, { result: { ...result, truncated: true }, kind: "oracle" }),
  );
  expect(html).toContain("Anzeige begrenzt");
  expect(grid?.kind).toBe("oracle");
  expect(html).not.toContain("vollständig");
});

test("the real dialog shows only the current success and escapes names and SQL", () => {
  view = { ...view, state: { status: "success", result, runId: 1 }, pending: false };
  expect(dialog()).toContain("data-existing-result-grid");
  const html = renderToStaticMarkup(
    createElement(ProcedureRunDialog, {
      open: true,
      onOpenChange: () => {},
      schema: "<script>",
      name: '"p"',
      identityArgs: "arg text",
    }),
  );
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
});

test("loading disables parameters and execute but leaves close available and old rows absent", () => {
  view = { ...view, state: { status: "loading" }, pending: true };
  const html = dialog();
  expect(html).toContain("Wird ausgeführt…");
  expect(html).not.toContain("data-existing-result-grid");
  expect(html.match(/disabled=""/g)?.length).toBe(2);
  expect(html).toContain("Schließen");
  view = { ...view, state: { status: "idle" } };
  expect(dialog()).toContain("Vorheriger Aufruf läuft…");
});

test("a failure replaces success; idle never displays an unexecuted result", () => {
  view = { ...view, state: { status: "error", message: "<failed>" }, pending: false };
  const html = dialog();
  expect(html).toContain('role="alert"');
  expect(html).toContain("&lt;failed&gt;");
  expect(html).not.toContain("data-existing-result-grid");
  view = { ...view, state: { status: "idle" } };
  expect(dialog()).not.toContain("Ausgeführt in");
});

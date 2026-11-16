import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SchemaCompareReportActions } from "../src/features/schema-compare/schema-compare-report-actions";
import { reportState } from "./fixtures/schema-report";

test("existing toolbar action is keyboard-reachable for a current comparison", () => {
  const state = reportState();
  const markup = renderToStaticMarkup(
    createElement(SchemaCompareReportActions, {
      state,
      getCurrent: () => state,
      script: { statements: [], warnings: [] },
    }),
  );
  expect(markup).toContain('aria-label="Schemaänderungsbericht"');
  expect(markup).toContain('aria-haspopup="menu"');
  expect(markup).not.toContain('disabled=""');
  expect(markup).toContain("Bericht");
});

test("no comparison, failed run, stale settings or loading disable the action", () => {
  const initial = reportState();
  for (const state of [
    { ...initial, result: null },
    { ...initial, error: "failed" },
    { ...initial, loading: "reading" },
    { ...initial, types: [] },
  ]) {
    const markup = renderToStaticMarkup(
      createElement(SchemaCompareReportActions, {
        state,
        getCurrent: () => state,
        script: { statements: [], warnings: [] },
      }),
    );
    expect(markup).toContain('disabled=""');
  }
});

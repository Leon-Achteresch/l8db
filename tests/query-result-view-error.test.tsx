import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const tabState = await import("../src/lib/tab-state");
mock.module("../src/lib/tab-state", () => ({
  ...tabState,
  useTabState: <T,>(key: string, initial: T) =>
    [
      tabState.readTabState<T>(key) ?? initial,
      (value: T) => tabState.writeTabState(key, value),
    ] as const,
}));
mock.module("../src/features/query/query-result-view/query-result-view", () => ({
  QueryResultView: ({ runId }: { runId: string }) =>
    createElement("section", { "data-view": runId }),
}));
mock.module("../src/features/query/query-result-workbench", () => ({
  QueryResultWorkbench: () => createElement("section", { "data-workbench": "" }),
}));
mock.module("../src/features/query/query-result-table/result-error", () => ({
  ResultError: ({ error }: { error: string }) => createElement("p", { "data-error": error }),
}));
mock.module("../src/features/query/result-compare/result-compare-view", () => ({
  ResultCompareView: () => null,
}));
mock.module("../src/features/query/result-snapshots-button", () => ({
  ResultSnapshotsButton: () => null,
}));

const { QueryResultsContent } = await import(
  "../src/features/query/query-view/query-results-content"
);
type Exec = Parameters<typeof QueryResultsContent>[0]["exec"];

const result = { columns: ["id"], rows: [{ id: 1 }] } as unknown as Exec["result"];

function render(patch: Partial<Exec>) {
  const exec = {
    scope: "query:style-test",
    result,
    isRunning: false,
    error: null,
    statementError: null,
    viewSource: { text: "SELECT * FROM t", runId: "run-1" },
    scriptEntries: null,
    runs: { baseline: null, latest: null, pinned: false },
    setRuns: () => {},
    resultOrigin: null,
    editorError: null,
    executedSql: "SELECT * FROM t",
    ...patch,
  } as unknown as Exec;
  return renderToStaticMarkup(
    createElement(QueryResultsContent, {
      exec,
      kind: "oracle",
      statusText: null,
      actions: null,
      onRevealError: () => {},
      tables: [],
      maximized: false,
      onToggleMaximized: () => {},
      compareOpen: false,
      connectionId: "c1",
      database: null,
    }),
  );
}

test("keeps the styled result view across a failed query", () => {
  expect(render({})).toContain('data-view="run-1"');

  const failed = render({ error: "ORA-00942: Tabelle oder View nicht vorhanden" });
  expect(failed).toContain('data-view="run-1"');
  expect(failed).toContain("data-error=");
  expect(failed).not.toContain("data-workbench");

  const next = render({ viewSource: { text: "SELECT * FROM t", runId: "run-2" } });
  expect(next).toContain('data-view="run-2"');
});

test("shows only the error when no previous result exists", () => {
  const markup = render({ error: "ORA-00942", result: null });
  expect(markup).toContain("data-error=");
  expect(markup).not.toContain("data-view");
});

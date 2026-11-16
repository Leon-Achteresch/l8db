import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { QueryResultStatus } from "../src/features/query/query-result-status";
import { queryTimingDescription, withAdapterResultTiming } from "../src/lib/query-result-timing";

const result = { columns: ["id"], rows: [{ id: 1 }], rows_affected: null, execution_time_ms: 5 };
function render(details?: string) {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(QueryResultStatus, { text: "1 Zeile · 5 ms", details, className: "truncate" }),
    ),
  );
}

test("timing explanation is attached to a keyboard-reachable existing status", () => {
  const html = render(queryTimingDescription(withAdapterResultTiming(result, "postgres")));
  expect(html).toContain("<button");
  expect(html).toContain('type="button"');
  expect(html).toContain("aria-label=");
  expect(html).toContain("Ergebnistransport");
  expect(html).toContain("keine reine Serverzeit");
  expect(html).toContain("truncate");
});

test("unknown boundaries are explained without promising server or total wait time", () => {
  const html = render(queryTimingDescription(result));
  expect(html).toContain("Messgrenze nicht belegt");
  expect(html).not.toContain("Adapterzeit vom Abfragestart");
});

test("non-query status callers retain plain text and do not gain a fabricated timing tooltip", () => {
  const html = render();
  expect(html).toBe('<span class="truncate">1 Zeile · 5 ms</span>');
});

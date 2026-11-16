import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { ElasticExactFilterHint } from "../src/features/table/elastic-exact-filter-hint";
import type { DetailedColumnInfo, ExactFilterMetadata } from "../src/lib/db";
import { keywordFilterHint } from "../src/lib/keyword-filter-hint";

function column(metadata?: ExactFilterMetadata, data_type = "text"): DetailedColumnInfo {
  return {
    name: "message",
    data_type,
    is_nullable: true,
    column_default: null,
    is_primary_key: false,
    ordinal_position: 1,
    character_maximum_length: null,
    exact_filter: metadata,
  };
}
const metadata: ExactFilterMetadata = {
  target: "message.keyword",
  strategy: "keyword",
  ignore_above: { state: "configured", value: 256 },
  scope: "single_index",
  index_mode: "unverified",
};

test("exact operators show only mapping facts, not effective indexing guarantees", () => {
  for (const operator of ["eq", "neq", "in", "notIn"]) {
    const hint = keywordFilterHint("elasticsearch", column(metadata), operator);
    expect(hint?.summary).toBe("Exakt über message.keyword · ignore_above=256");
    expect(hint?.details).toContain("Nichttreffer beweist nicht");
    expect(hint?.details).toContain("Indexmodus");
    expect(hint?.details).toContain("kein Nachweis vollständiger Indexierung");
  }
  for (const operator of ["contains", "gt", "isNull"])
    expect(keywordFilterHint("elasticsearch", column(metadata), operator)).toBeNull();
  expect(keywordFilterHint("postgres", column(metadata), "eq")).toBeNull();
  expect(keywordFilterHint("elasticsearch", column(undefined, "long"), "eq")).toBeNull();
});

test("missing, absent, malformed and multi-index metadata are distinct from unlimited", () => {
  expect(keywordFilterHint("elasticsearch", column(), "eq")?.summary).toContain("unbekannt");
  expect(keywordFilterHint("elasticsearch", undefined, "eq")?.summary).toContain("unbekannt");
  const old = column();
  old.comment = "Keyword-Feld: message.keyword";
  expect(keywordFilterHint("elasticsearch", old, "eq")?.summary).toContain("unbekannt");
  expect(
    keywordFilterHint(
      "elasticsearch",
      column({ ...metadata, ignore_above: { state: "not_declared" } }),
      "eq",
    )?.summary,
  ).toContain("keine Feldgrenze angegeben");
  expect(
    keywordFilterHint("elasticsearch", column({ ...metadata, scope: "multiple_indices" }), "eq")
      ?.summary,
  ).toContain("mehreren Mappings unbekannt");
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    expect(
      keywordFilterHint(
        "elasticsearch",
        column({ ...metadata, ignore_above: { state: "configured", value } }),
        "eq",
      )?.summary,
    ).toContain("unbekannt");
  expect(
    keywordFilterHint(
      "elasticsearch",
      column({ ...metadata, ignore_above: { state: "configured", value: 0 } }),
      "eq",
    )?.summary,
  ).toContain("ignore_above=0");
  const phrase = keywordFilterHint(
    "elasticsearch",
    column({ ...metadata, target: "message", strategy: "match_phrase" }),
    "eq",
  );
  expect(phrase?.summary).toContain("Match-Phrase");
  expect(phrase?.details).toContain("keine garantierte Rohwertgleichheit");
});

test("existing accessible tooltip escapes names and does not require an app or database", () => {
  const injected = column({ ...metadata, target: '<img src=x onerror="bad()">' });
  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(ElasticExactFilterHint, {
        kind: "elasticsearch",
        column: injected,
        operator: "eq",
      }),
    ),
  );
  expect(markup).toContain("<button");
  expect(markup).toContain('type="button"');
  expect(markup).toContain("aria-label=");
  expect(markup).not.toContain("<img");
  expect(markup).toContain("&lt;img");
  expect(markup).toContain("Indexmodus");
});

test("existing bridge carries optional hints and legacy columns in a single request", async () => {
  const calls: { command: string; args: unknown }[] = [];
  const response = [column(metadata), column()];
  mock.module("../src/lib/db/core", () => ({
    invoke: async (command: string, args: unknown) => {
      calls.push({ command, args });
      return response;
    },
  }));
  const { listTableColumnsDetailed } = await import("../src/lib/db/columns");
  expect(
    await listTableColumnsDetailed("elasticsearch", "fixture://no-network", "indices", "logs"),
  ).toBe(response);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.command).toBe("list_table_columns_detailed");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(calls).toHaveLength(1);
});

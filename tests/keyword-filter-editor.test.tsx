import { expect, mock, test } from "bun:test";
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("../src/lib/connections", () => ({
  useActiveConnection: () => ({ id: "fixture", kind: "elasticsearch" }),
}));
const passthrough = ({ children }: { children?: ReactNode }) =>
  createElement(Fragment, null, children);
mock.module("../src/components/ui/select", () => ({
  Select: passthrough,
  SelectContent: passthrough,
  SelectItem: passthrough,
  SelectTrigger: passthrough,
  SelectValue: () => null,
}));
mock.module("../src/features/filters/filter-operator-select", () => ({
  FilterOperatorSelect: () => null,
}));
mock.module("../src/features/filters/filter-value-input", () => ({ FilterValueInput: () => null }));
const { FilterConditionFields } = await import(
  "../src/features/table/filter-bar/filter-condition-fields"
);
const { TooltipProvider } = await import("../src/components/ui/tooltip");

function render(filterHints: boolean, known = true) {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(FilterConditionFields, {
        condition: { id: "c1", column: "message", operator: "eq", value: "a value", enabled: true },
        columns: ["message"],
        columnDetails: [
          {
            name: "message",
            data_type: "text",
            is_nullable: true,
            column_default: null,
            is_primary_key: false,
            ordinal_position: 1,
            character_maximum_length: null,
            exact_filter: known
              ? {
                  target: "message.keyword",
                  strategy: "keyword",
                  ignore_above: { state: "configured", value: 256 },
                  scope: "single_index",
                  index_mode: "unverified",
                }
              : undefined,
          },
        ],
        filterHints,
        onChange: () => {},
        onSubmit: () => {},
      }),
    ),
  );
}

test("database filter editor displays real metadata but local row-rule fields stay free of server hints", () => {
  expect(render(true)).toContain("ignore_above=256");
  expect(render(true, false)).toContain("Keyword-Grenze unbekannt");
  expect(render(false)).not.toContain("ignore_above");
  expect(render(false)).not.toContain("Keyword-Grenze");
});

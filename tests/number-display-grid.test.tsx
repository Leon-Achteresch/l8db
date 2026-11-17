import { expect, mock, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const settings = await import("../src/lib/query-qol-settings");
mock.module("../src/lib/query-qol-settings", () => ({
  ...settings,
  useQueryQolSettings: Object.assign(
    (selector: (state: ReturnType<typeof settings.useQueryQolSettings.getState>) => unknown) =>
      selector(settings.useQueryQolSettings.getState()),
    settings.useQueryQolSettings,
  ),
}));
const { DataTableCell } = await import("../src/features/table/data-table-cell");
const { QueryResultCell } = await import("../src/features/query/query-result-cell");
const { GridStyleContext } = await import("../src/features/table/data-table/grid-style-context");
const grouped = { mode: "grouped", minimumFractionDigits: 2 } as const;
type Node = React.ReactElement<Record<string, unknown>>;
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(value)) return [];
  return [value, ...nodes(value.props.children)];
}
function requiredNode(tree: unknown, title: string) {
  const found = nodes(tree).find((node) => node.props.title === title);
  if (!found) throw Error(`Missing control: ${title}`);
  return found;
}
function fixture(value: unknown, dataType?: string) {
  const original = Object.freeze({ __ctid__: "(0,1)@1@2", amount: value });
  const row = { index: 0, original, getValue: () => value };
  const copied: unknown[] = [];
  const edited: unknown[] = [];
  const inspected: unknown[] = [];
  const props = {
    row,
    table: {},
    column: { id: "amount", columnDef: { meta: { dataType } } },
    cellIndex: 1,
    width: 1000,
    previewWidth: 1000,
    fontSize: 12,
    hasCustomContent: false,
    monochromeCells: false,
    isActive: true,
    isMarked: false,
    isSelected: false,
    isMatch: false,
    isActiveMatch: false,
    pinnedOffset: null,
    hasOutgoingFk: false,
    pageOffset: 0,
    canSave: true,
    isSaving: false,
    editingCell: null,
    canPickFk: false,
    handleCellCopy: (raw: unknown) => copied.push(raw),
    handleCellEdit: (r: unknown) => edited.push(r),
    setInspectCell: (raw: unknown) => inspected.push(raw),
    setEditingCell: () => {},
    focusCell: () => {},
    toggleRowMarker: () => {},
  };
  return { props, row, original, copied, edited, inspected };
}
function cellTree(props: Record<string, unknown>) {
  const internals = (
    React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown };
    }
  ).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H;
  internals.H = {
    useMemo: (create: () => unknown) => create(),
    useContext: () => ({ style: "classic", columns: new Map(), now: new Date() }),
  };
  try {
    return (
      DataTableCell as unknown as { type: (props: Record<string, unknown>) => React.ReactNode }
    ).type(props);
  } finally {
    internals.H = previous;
  }
}

test("actual table cell renders grouped exact values in every existing table style", () => {
  settings.useQueryQolSettings.getState().setNumbers(grouped);
  const f = fixture("9007199254740993.1234500", "numeric(40,7)");
  for (const style of ["classic", "compact", "semantic", "profile"] as const) {
    const html = renderToStaticMarkup(
      React.createElement(
        GridStyleContext.Provider,
        { value: { style, columns: new Map(), now: new Date() } },
        React.createElement(DataTableCell, f.props as never),
      ),
    );
    expect(html).toContain("9\u202f007\u202f199\u202f254\u202f740\u202f993.1234500");
    expect(html).toContain('title="9007199254740993.1234500"');
  }
});

test("actual copy, inspect and edit handlers receive source data, never display text", () => {
  settings.useQueryQolSettings.getState().setNumbers(grouped);
  const f = fixture("9007199254740993.1234500", "numeric");
  const tree = cellTree(f.props);
  (requiredNode(tree, "Kopieren").props.onClick as (event: unknown) => void)({
    stopPropagation: () => {},
  });
  (requiredNode(tree, "Anzeigen / bearbeiten").props.onClick as (event: unknown) => void)({
    stopPropagation: () => {},
  });
  const cell = nodes(tree)[0];
  (cell.props.onDoubleClick as (event: unknown) => void)({ stopPropagation: () => {} });
  expect(f.copied).toEqual([f.original.amount]);
  expect(f.inspected).toMatchObject([{ value: f.original.amount, originalValues: f.original }]);
  expect(f.edited).toEqual([f.row]);
});

test("known text IDs and metadata-less result strings remain unformatted while native numeric results format", () => {
  settings.useQueryQolSettings.getState().setNumbers(grouped);
  const f = fixture("001234567890", "varchar");
  const html = renderToStaticMarkup(React.createElement(DataTableCell, f.props as never));
  expect(html).toContain("001234567890");
  expect(html).not.toContain("\u202f");
  const render = (value: unknown) =>
    renderToStaticMarkup(
      React.createElement(QueryResultCell, {
        column: "v",
        value,
        row: { v: value },
        rowIndex: 0,
        originalIndex: 0,
        selectionKey: null,
        active: false,
        fontSize: 12,
        width: 1000,
      }),
    );
  expect(render("9007199254740993")).toContain("9007199254740993");
  expect(render("9007199254740993")).not.toContain("\u202f");
  expect(render(1234567.125)).toContain("1\u202f234\u202f567.125");
  expect(render(null)).toContain("NULL");
});

test("restoring raw mode preserves the exact previous cell rendering and row value", () => {
  const f = fixture("12345678901234567890.1200", "numeric");
  settings.useQueryQolSettings.getState().setNumbers({ mode: "raw", minimumFractionDigits: 0 });
  const before = renderToStaticMarkup(React.createElement(DataTableCell, f.props as never));
  settings.useQueryQolSettings.getState().setNumbers(grouped);
  expect(renderToStaticMarkup(React.createElement(DataTableCell, f.props as never))).not.toBe(
    before,
  );
  settings.useQueryQolSettings.getState().setNumbers({ mode: "raw", minimumFractionDigits: 4 });
  expect(renderToStaticMarkup(React.createElement(DataTableCell, f.props as never))).toBe(before);
  expect(f.row.getValue()).toBe("12345678901234567890.1200");
});

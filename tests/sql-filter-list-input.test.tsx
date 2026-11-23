import { expect, mock, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileSingleCondition } from "../src/lib/sql-filter";

mock.module("../src/lib/hooks/use-new-feature-visibility", () => ({
  useNewFeatureVisibility: () => ({ ref: () => {}, isNew: false }),
}));
mock.module("../src/components/ui/popover", () => ({
  Popover: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    React.createElement("div", { "data-open": open }, children),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => children,
  PopoverContent: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement("div", props, children),
}));
const { FilterValueInput } = await import("../src/features/filters/filter-value-input");
const { SqlFilterListImport } = await import("../src/features/filters/sql-filter-list-import");
const internals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown };
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

type Node = React.ReactElement<Record<string, unknown>>;
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(value)) return [];
  return [value, ...nodes(value.props.children)];
}
function findNode(tree: unknown, predicate: (node: Node) => boolean): Node {
  const node = nodes(tree).find(predicate);
  if (!node) throw Error("Expected filter control is missing");
  return node;
}
function harness() {
  const slots: unknown[] = [];
  return (render: () => React.ReactNode) => {
    let index = 0;
    const effects: (() => void)[] = [];
    const previous = internals.H;
    internals.H = {
      useState: (initial: unknown) => {
        const key = index++;
        if (!(key in slots)) slots[key] = typeof initial === "function" ? initial() : initial;
        return [
          slots[key],
          (next: unknown) => {
            slots[key] = typeof next === "function" ? next(slots[key]) : next;
          },
        ];
      },
      useRef: (initial: unknown) => {
        const key = index++;
        if (!(key in slots)) slots[key] = { current: initial };
        return slots[key];
      },
      useMemo: (create: () => unknown) => create(),
      useId: () => "sql-list-test",
      useEffect: (effect: () => void) => effects.push(effect),
    };
    try {
      const tree = render();
      for (const effect of effects) effect();
      return tree;
    } finally {
      internals.H = previous;
    }
  };
}

function setup(operator = "in", initial = '["existing"]') {
  const render = harness();
  let value = initial;
  const changes: string[] = [];
  const props = {
    operator,
    value,
    onValueChange: (next: string) => {
      changes.push(next);
      value = next;
    },
  };
  const tree = () => render(() => FilterValueInput({ ...props, value }));
  const importer = () => findNode(tree(), (node) => node.type === SqlFilterListImport);
  const panel = () => render(() => SqlFilterListImport(importer().props as never));
  const paste = (source: string) => {
    const input = findNode(tree(), (node) => typeof node.props.onPaste === "function");
    let prevented = false;
    (input.props.onPaste as (event: unknown) => void)({
      clipboardData: { getData: () => source },
      preventDefault: () => {
        prevented = true;
      },
    });
    return prevented;
  };
  const confirm = () => {
    const button = findNode(panel(), (node) => node.props.children === "Werte übernehmen");
    (button.props.onClick as () => void)();
    return button;
  };
  return {
    tree,
    importer,
    panel,
    paste,
    confirm,
    changes,
    props,
    getValue: () => value,
    setValue: (next: string) => {
      value = next;
    },
  };
}

test("actual paste opens a preview and only the explicit import action changes the existing filter value", () => {
  const form = setup();
  expect(form.paste("('A', 'O''Brien', 'a,b')")).toBe(true);
  expect(form.changes).toEqual([]);
  expect(form.importer().props.source).toBe("('A', 'O''Brien', 'a,b')");
  form.confirm();
  expect(form.changes).toEqual(['["existing","A","O\'Brien","a,b"]']);
  expect(form.importer().props.source).toBeNull();
  expect(compileSingleCondition("name", "in", form.getValue(), "postgres", "text")).toBe(
    `"name" IN ('existing', 'A', 'O''Brien', 'a,b')`,
  );
});

test("invalid syntax, disabled input and duplicate-only input cannot mutate values", () => {
  const form = setup();
  form.paste("('a', NULL)");
  expect(form.confirm().props.disabled).toBe(true);
  expect(form.changes).toEqual([]);
  form.paste("('existing')");
  expect(form.confirm().props.disabled).toBe(true);
  expect(form.changes).toEqual([]);
  const render = harness();
  const tree = render(() =>
    FilterValueInput({
      operator: "in",
      value: "",
      disabled: true,
      onValueChange: () => {
        throw Error("disabled change");
      },
    }),
  );
  const paste = findNode(tree, (node) => typeof node.props.onPaste === "function");
  let prevented = false;
  (paste.props.onPaste as (event: unknown) => void)({
    clipboardData: { getData: () => "('a')" },
    preventDefault: () => {
      prevented = true;
    },
  });
  expect(prevented).toBe(false);
});

test("cancel and changed current list/operator discard the source without overwriting a newer value", () => {
  const form = setup();
  form.paste("('a')");
  (form.importer().props.onSourceChange as (source: null) => void)(null);
  expect(form.changes).toEqual([]);
  expect(form.importer().props.source).toBeNull();
  form.paste("('a')");
  form.setValue('["newer"]');
  expect(form.importer().props.source).toBeNull();
  expect(form.getValue()).toBe('["newer"]');
  form.props.operator = "notIn";
  expect(form.importer().props.source).toBeNull();
  form.props.operator = "in";
  form.setValue('["existing"]');
  expect(form.importer().props.source).toBeNull();
});

test("preview Enter is isolated from the containing filter's submit handler", () => {
  const form = setup();
  form.paste("('a')");
  const content = findNode(form.panel(), (node) => typeof node.props.onKeyDown === "function");
  let stopped = false;
  (content.props.onKeyDown as (event: unknown) => void)({
    stopPropagation: () => {
      stopped = true;
    },
  });
  expect(stopped).toBe(true);
  expect(form.changes).toEqual([]);
});

test("preview has at most five bounded value nodes and an honest remainder", () => {
  const source = `(${Array.from({ length: 1000 }, (_, index) => `'${index}-${"x".repeat(120)}'`).join(",")})`;
  const html = renderToStaticMarkup(
    React.createElement(SqlFilterListImport, {
      source,
      initialSource: "",
      value: "",
      onSourceChange: () => {},
      onImport: () => {},
    }),
  );
  expect((html.match(/data-sql-list-preview=/g) ?? []).length).toBe(5);
  expect(html).toContain("995 weitere");
  expect(html).toContain("Der Spaltentyp bestimmt die SQL-Literale");
  const invalid = renderToStaticMarkup(
    React.createElement(SqlFilterListImport, {
      source: "('a', NULL)",
      initialSource: "",
      value: "",
      onSourceChange: () => {},
      onImport: () => {},
    }),
  );
  expect(invalid).toContain('role="alert"');
  expect(invalid).toContain("SQL-NULL");
});

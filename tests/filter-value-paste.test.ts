import { describe, expect, test } from "bun:test";
import * as React from "react";

const internals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown };
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

const { FilterValueInput } = await import("../src/features/filters/filter-value-input");

type PasteHandler = (event: {
  clipboardData: { getData: () => string };
  preventDefault: () => void;
}) => void;

function findPasteHandler(node: unknown): PasteHandler | undefined {
  if (!node || typeof node !== "object") return undefined;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return undefined;
  if (typeof props.onPaste === "function") return props.onPaste as PasteHandler;
  const children = props.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) {
    const found = findPasteHandler(child);
    if (found) return found;
  }
  return undefined;
}

function paste(operator: string, value: string, text: string) {
  const previous = internals.H;
  internals.H = {
    useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => {}],
    useRef: (initial: unknown) => ({ current: initial }),
  };
  const changes: string[] = [];
  let prevented = false;
  try {
    const element = FilterValueInput({
      operator,
      value,
      onValueChange: (next: string) => void changes.push(next),
    });
    findPasteHandler(element)?.({
      clipboardData: { getData: () => text },
      preventDefault: () => {
        prevented = true;
      },
    });
  } finally {
    internals.H = previous;
  }
  return { changes, prevented };
}

describe("filter value paste", () => {
  test("single-value operators keep pasted text untouched", () => {
    for (const operator of ["eq", "neq", "contains", "startsWith", "gt", "like"]) {
      for (const text of ["a;b", "1,5", "foo,bar", "Hauptstr. 1\n12345 Berlin", "a\tb"]) {
        expect(paste(operator, "", text)).toEqual({ changes: [], prevented: false });
      }
    }
  });

  test("list operators still split pasted values into entries", () => {
    expect(paste("in", '["x"]', "a;b\nc")).toEqual({
      changes: [JSON.stringify(["x", "a", "b", "c"])],
      prevented: true,
    });
    expect(paste("notIn", "", "single")).toEqual({ changes: [], prevented: false });
  });
});

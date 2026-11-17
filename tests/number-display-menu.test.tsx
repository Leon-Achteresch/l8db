import { afterEach, expect, mock, test } from "bun:test";
import * as React from "react";

const settings = await import("../src/lib/query-qol-settings");
mock.module("../src/lib/query-qol-settings", () => ({
  ...settings,
  useQueryQolSettings: Object.assign(
    (select: (state: ReturnType<typeof settings.useQueryQolSettings.getState>) => unknown) =>
      select(settings.useQueryQolSettings.getState()),
    settings.useQueryQolSettings,
  ),
}));
const features: string[] = [];
mock.module("../src/lib/hooks/use-new-feature-visibility", () => ({
  useNewFeatureVisibility: (id: string) => {
    features.push(id);
    return { isNew: true, ref: () => {} };
  },
}));
const { NumberDisplayMenu } = await import("../src/features/table/number-display-menu");
const { DropdownMenuRadioGroup, DropdownMenuRadioItem } = await import(
  "../src/components/ui/dropdown-menu"
);
type Node = React.ReactElement<Record<string, unknown>>;
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(value)) return [];
  return [value, ...nodes(value.props.children)];
}
function groups() {
  return nodes(NumberDisplayMenu()).filter((node) => node.type === DropdownMenuRadioGroup);
}
afterEach(() =>
  settings.useQueryQolSettings.getState().setNumbers({ mode: "raw", minimumFractionDigits: 0 }),
);

test("existing menu action explicitly changes only display state and carries the real feature marker", () => {
  const before = settings.useQueryQolSettings.getState();
  const change = (group: number, value: string) =>
    (groups()[group].props.onValueChange as (value: string) => void)(value);
  expect(
    nodes(NumberDisplayMenu()).filter(
      (node) => node.type === DropdownMenuRadioItem && node.props.disabled === true,
    ),
  ).toHaveLength(3);
  change(0, "grouped");
  change(1, "4");
  expect(settings.useQueryQolSettings.getState().numbers).toEqual({
    mode: "grouped",
    minimumFractionDigits: 4,
  });
  expect(
    nodes(NumberDisplayMenu()).filter(
      (node) => node.type === DropdownMenuRadioItem && node.props.disabled === true,
    ),
  ).toHaveLength(0);
  change(0, "raw");
  expect(settings.useQueryQolSettings.getState().numbers).toEqual({
    mode: "raw",
    minimumFractionDigits: 4,
  });
  expect(settings.useQueryQolSettings.getState().timestamps).toBe(before.timestamps);
  expect(settings.useQueryQolSettings.getState().notifications).toBe(before.notifications);
  expect(features).toContain("query.results.numbers");
});

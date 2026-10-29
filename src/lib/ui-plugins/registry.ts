import type { ReactNode } from "react";
import {
  type CellProps,
  type ColumnInfo,
  type ColumnPatch,
  type DetailTab,
  type OptionValues,
  type PluginDefinition,
  type Row,
  resolveOptions,
  type Slots,
  type SplitLayout,
  type TabGroup,
  type TabInfo,
  type TabItemProps,
  type TableInfo,
  type Template,
  type Tone,
  type ToolbarAction,
  validateColumnPatches,
  validateDetailTabs,
  validateSlots,
  validateSplitLayout,
  validateTabGroup,
  validateTone,
  validateToolbarActions,
} from "./api";
import { errorMessage, type GuardEvents, SlotGuard, type SlotName } from "./guard";

export type ActivePlugin = {
  id: string;
  name: string;
  file: string;
  definition: PluginDefinition;
  options: OptionValues;
  http: string[];
};

export type PluginNode = { plugin: string; node: ReactNode };

export type ToolbarEntry = { plugin: ActivePlugin; action: ToolbarAction; key: string };

export type DetailTabEntry = { plugin: ActivePlugin; tab: DetailTab; key: `plugin:${string}` };

export type TemplateEntry = { plugin: ActivePlugin; template: Template; key: string };

export type UiPluginRegistry = {
  plugins: ActivePlugin[];
  cell: ((props: Omit<CellProps, "options">) => PluginNode | undefined) | null;
  rowTone: ((row: Row, table: TableInfo) => Tone | undefined) | null;
  columns: ((table: TableInfo, columns: readonly ColumnInfo[]) => ColumnPatch[]) | null;
  toolbar: ((table: TableInfo) => ToolbarEntry[]) | null;
  detailTabs: ((table: TableInfo) => DetailTabEntry[]) | null;
  tabGroup: ((tab: TabInfo) => TabGroup | undefined) | null;
  tabItem: ((props: TabItemProps) => PluginNode | undefined) | null;
  closeButton: "auto" | "always" | "hover" | "never";
  newTabPosition: "end" | "afterActive";
  splitLayout:
    | ((count: number, orientation: "horizontal" | "vertical") => SplitLayout | undefined)
    | null;
  autoSaveGroups: boolean;
  templates: TemplateEntry[];
  guards: SlotGuard[];
};

export type RegistryInput = {
  plugins: readonly { file: string; definition: PluginDefinition }[];
  disabled: readonly string[];
  options: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  grants: Readonly<Record<string, readonly string[]>>;
  tripped: Readonly<Record<string, string>>;
  events: GuardEvents & { slotsError(plugin: string, message: string): void };
};

export const EMPTY_REGISTRY: UiPluginRegistry = {
  plugins: [],
  cell: null,
  rowTone: null,
  columns: null,
  toolbar: null,
  detailTabs: null,
  tabGroup: null,
  tabItem: null,
  closeButton: "auto",
  newTabPosition: "end",
  splitLayout: null,
  autoSaveGroups: true,
  templates: [],
  guards: [],
};

export function slotKey(plugin: string, slot: SlotName) {
  return `${plugin}:${slot}`;
}

function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

class PluginCellProps implements CellProps {
  readonly value: unknown;
  readonly row: Row;
  readonly column: ColumnInfo;
  readonly table: TableInfo;
  readonly rowIndex: number;
  readonly #source: Omit<CellProps, "options">;

  constructor(
    source: Omit<CellProps, "options">,
    readonly options: OptionValues,
  ) {
    this.value = source.value;
    this.row = source.row;
    this.column = source.column;
    this.table = source.table;
    this.rowIndex = source.rowIndex;
    this.#source = source;
  }

  get rows() {
    return this.#source.rows;
  }
}

export function buildRegistry(input: RegistryInput): UiPluginRegistry {
  const entries: { plugin: ActivePlugin; slots: Slots }[] = [];
  for (const { file, definition } of input.plugins) {
    if (input.disabled.includes(definition.id)) continue;
    const options = resolveOptions(definition.options, input.options[definition.id]);
    let slots: Slots;
    try {
      slots =
        typeof definition.slots === "function"
          ? validateSlots(definition.slots(options))
          : definition.slots;
    } catch (error) {
      input.events.slotsError(definition.id, errorMessage(error));
      continue;
    }
    const granted = input.grants[definition.id] ?? [];
    entries.push({
      plugin: {
        id: definition.id,
        name: definition.name,
        file,
        definition,
        options,
        http: definition.http.filter((pattern) => granted.includes(pattern)),
      },
      slots,
    });
  }
  if (entries.length === 0) return EMPTY_REGISTRY;

  const guards: SlotGuard[] = [];
  const pick = <F>(slot: SlotName, select: (slots: Slots) => F | undefined) =>
    entries.flatMap(({ plugin, slots }) => {
      const fn = select(slots);
      if (!fn || input.tripped[slotKey(plugin.id, slot)]) return [];
      const guard = new SlotGuard(plugin.id, slot, input.events);
      guards.push(guard);
      return [{ plugin, fn, guard }];
    });

  const cells = pick("grid.cell", (slots) => slots.grid?.cell);
  const tones = pick("grid.rowTone", (slots) => slots.grid?.rowTone);
  const columns = pick("grid.columns", (slots) => slots.grid?.columns);
  const toolbars = pick("table.toolbar", (slots) => slots.table?.toolbar);
  const detailTabs = pick("table.detailTabs", (slots) => slots.table?.detailTabs);
  const groups = pick("tabs.group", (slots) => slots.tabs?.group);
  const items = pick("tabs.item", (slots) => slots.tabs?.item);
  const layouts = pick("split.layout", (slots) => slots.split?.layout);

  let closeButton: UiPluginRegistry["closeButton"] = "auto";
  let newTabPosition: UiPluginRegistry["newTabPosition"] = "end";
  let autoSaveGroups = true;
  const templates: TemplateEntry[] = [];
  for (const { plugin, slots } of entries) {
    closeButton = slots.tabs?.options?.closeButton ?? closeButton;
    newTabPosition = slots.tabs?.options?.newTabPosition ?? newTabPosition;
    autoSaveGroups = slots.split?.options?.autoSaveGroups ?? autoSaveGroups;
    for (const template of slots.split?.templates ?? [])
      templates.push({ plugin, template, key: `${plugin.id}:${template.id}` });
  }

  return {
    plugins: entries.map((entry) => entry.plugin),
    cell: cells.length
      ? (props) => {
          for (let index = cells.length - 1; index >= 0; index--) {
            const { plugin, fn, guard } = cells[index];
            const node = guard.run(() => fn(new PluginCellProps(props, plugin.options)), undefined);
            if (node !== undefined) return { plugin: plugin.id, node };
          }
          return undefined;
        }
      : null,
    rowTone: tones.length
      ? (row, table) => {
          for (let index = tones.length - 1; index >= 0; index--) {
            const { fn, guard } = tones[index];
            const tone = guard.run(() => validateTone(fn(row, table)), undefined);
            if (tone) return tone;
          }
          return undefined;
        }
      : null,
    columns: columns.length
      ? (table, list) => {
          const merged = new Map<string, ColumnPatch>();
          for (const { fn, guard } of columns)
            for (const patch of guard.run(() => validateColumnPatches(fn(table, list)), []))
              merged.set(patch.id, { ...merged.get(patch.id), ...defined(patch), id: patch.id });
          return [...merged.values()];
        }
      : null,
    toolbar: toolbars.length
      ? (table) =>
          toolbars.flatMap(({ plugin, fn, guard }) =>
            guard
              .run(() => validateToolbarActions(fn(table)), [])
              .map((action) => ({ plugin, action, key: `${plugin.id}:${action.id}` })),
          )
      : null,
    detailTabs: detailTabs.length
      ? (table) =>
          detailTabs.flatMap(({ plugin, fn, guard }) =>
            guard
              .run(() => validateDetailTabs(fn(table)), [])
              .map((tab) => ({ plugin, tab, key: `plugin:${plugin.id}:${tab.id}` as const })),
          )
      : null,
    tabGroup: groups.length
      ? (tab) => {
          for (let index = groups.length - 1; index >= 0; index--) {
            const { fn, guard } = groups[index];
            const group = guard.run(() => validateTabGroup(fn(tab)), undefined);
            if (group) return group;
          }
          return undefined;
        }
      : null,
    tabItem: items.length
      ? (props) => {
          for (let index = items.length - 1; index >= 0; index--) {
            const { plugin, fn, guard } = items[index];
            const node = guard.run(() => fn(props), undefined);
            if (node !== undefined) return { plugin: plugin.id, node };
          }
          return undefined;
        }
      : null,
    closeButton,
    newTabPosition,
    splitLayout: layouts.length
      ? (count, orientation) => {
          for (let index = layouts.length - 1; index >= 0; index--) {
            const { fn, guard } = layouts[index];
            const layout = guard.run(() => validateSplitLayout(fn(count, orientation)), undefined);
            if (layout) return layout;
          }
          return undefined;
        }
      : null,
    autoSaveGroups,
    templates,
    guards,
  };
}

export function guardFor(registry: UiPluginRegistry, plugin: string, slot: SlotName) {
  return registry.guards.find((guard) => guard.plugin === plugin && guard.slot === slot);
}

import { useMemo } from "react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import type { SavedConnection } from "@/lib/connections/types";
import type { TableTab } from "@/lib/table-tabs";
import type { HttpInit, Row, TableInfo, Tone } from "./api";
import { pluginHttp } from "./http";
import { tableInfo } from "./info";
import type { ActivePlugin, DetailTabEntry, ToolbarEntry } from "./registry";
import { useUiPluginRegistry } from "./store";

const NO_TOOLBAR: ToolbarEntry[] = [];
const NO_TABS: DetailTabEntry[] = [];
const NO_ROWS: readonly Row[] = Object.freeze([]);
const MAX_SELECTIONS = 20;

const selections = new Map<string, readonly Row[]>();

export function publishPluginSelection(key: string, selection: readonly Row[]) {
  selections.delete(key);
  selections.set(key, selection);
  if (selections.size > MAX_SELECTIONS) selections.delete(selections.keys().next().value as string);
}

export function pluginSelection(key: string | null | undefined, rows: readonly Row[]) {
  const selection = (key && selections.get(key)) || NO_ROWS;
  if (selection.length === 0) return NO_ROWS;
  const current = new Set(rows);
  return selection.filter((row) => current.has(row));
}

export function usePluginTableInfo(
  connection: SavedConnection | null | undefined,
  database: string | null | undefined,
  schema: string,
  table: string,
  isView: boolean,
): TableInfo | null {
  const active = useUiPluginRegistry((registry) => !!(registry.toolbar || registry.detailTabs));
  return useMemo(
    () => (active && connection ? tableInfo(connection, database, schema, table, isView) : null),
    [active, connection, database, schema, table, isView],
  );
}

export function usePluginToolbar(info: TableInfo | null): ToolbarEntry[] {
  const toolbar = useUiPluginRegistry((registry) => registry.toolbar);
  return useMemo(() => (info && toolbar ? toolbar(info) : NO_TOOLBAR), [info, toolbar]);
}

export function usePluginDetailTabs(info: TableInfo | null): DetailTabEntry[] {
  const detailTabs = useUiPluginRegistry((registry) => registry.detailTabs);
  return useMemo(() => (info && detailTabs ? detailTabs(info) : NO_TABS), [info, detailTabs]);
}

export function pluginToast(plugin: ActivePlugin, text: unknown, tone?: Tone) {
  const message = `${plugin.name}: ${String(text).slice(0, 300)}`;
  if (tone === "success") toast.success(message);
  else if (tone === "warning") toast.warning(message);
  else if (tone === "danger") toast.error(message);
  else if (tone === "info") toast.info(message);
  else toast(message);
}

export function parseTableName(name: unknown): Omit<TableTab, "kind"> | null {
  if (typeof name !== "string") return null;
  const dot = name.indexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return { schema: name.slice(0, dot), table: name.slice(dot + 1) };
}

export function pluginServices(
  plugin: ActivePlugin,
  openTable: (tab: Omit<TableTab, "kind">) => void,
) {
  return {
    options: plugin.options,
    toast: (text: string, tone?: Tone) => pluginToast(plugin, text, tone),
    http: (url: string, init?: HttpInit) => pluginHttp(plugin, url, init),
    openTable: (name: string) => {
      const tab = parseTableName(name);
      if (!tab)
        throw new Error(`openTable erwartet "schema.tabelle", nicht ${JSON.stringify(name)}.`);
      openTable(tab);
    },
  };
}

export function pluginCopy(text: unknown) {
  return copyText(String(text));
}

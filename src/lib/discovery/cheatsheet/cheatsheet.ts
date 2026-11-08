import { type Hotkey, matchesKeyboardEvent } from "@tanstack/react-hotkeys";
import {
  FEATURE_CATALOG,
  type FeatureArea,
  type FeatureEntry,
  type FeatureSearchOptions,
  featureAvailable,
  searchFeatures,
} from "@/lib/discovery/catalog";
import { filterHotkeyCommands, isCommandVisibleInRoute } from "@/lib/hotkeys/filter";
import type { HotkeyArea, HotkeyCommand } from "@/lib/hotkeys/types";

export const CHEATSHEET_COMMAND = "help.cheatsheet";

const EDITABLE =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], [role="combobox"], .monaco-editor, .cm-editor';
const OPEN_DIALOG = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

const AREA_BY_SEGMENT: Readonly<Record<string, FeatureArea>> = {
  tables: "Daten & Tabellen",
  "view-editor": "Schema & Struktur",
  "alter-table": "Schema & Struktur",
  functions: "Schema & Struktur",
  procedures: "Schema & Struktur",
  packages: "Schema & Struktur",
  triggers: "Schema & Struktur",
};

export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as (Element & { isContentEditable?: boolean }) | null;
  if (!element || typeof element.closest !== "function") return false;
  if (element.isContentEditable) return true;
  return element.closest(EDITABLE) !== null;
}

export function dialogOpen(root: ParentNode = document): boolean {
  return root.querySelector(OPEN_DIALOG) !== null;
}

export function matchesCheatsheetKey(
  event: KeyboardEvent,
  hotkey: string,
  platform: "mac" | "windows" | "linux",
): boolean {
  if (hotkey === "?") return event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey;
  return matchesKeyboardEvent(event, hotkey as Hotkey, platform);
}

export function cheatsheetAreas(pathname: string): HotkeyArea[] {
  if (pathname.startsWith("/query")) return ["SQL-Editor", "Datengitter", "Tabs", "Allgemein"];
  if (pathname.includes("/tables/")) return ["Datengitter", "Tabs", "Navigation", "Allgemein"];
  return ["Tabs", "Navigation", "Allgemein"];
}

export function cheatsheetCommands(
  pathname: string,
  term: string,
  easyMode = false,
): { area: HotkeyArea; commands: HotkeyCommand[] }[] {
  const matching = filterHotkeyCommands(term).filter(
    (command) =>
      isCommandVisibleInRoute(command, pathname) && !(easyMode && command.id === "view.split"),
  );
  return cheatsheetAreas(pathname)
    .map((area) => ({ area, commands: matching.filter((command) => command.area === area) }))
    .filter((group) => group.commands.length > 0);
}

function routeSegment(pathname: string): string {
  return pathname.split("/")[1] ?? "";
}

export function featuresForRoute(
  pathname: string,
  term: string,
  options: Pick<FeatureSearchOptions, "capabilities" | "easyMode"> = {},
  entries: readonly FeatureEntry[] = FEATURE_CATALOG,
): FeatureEntry[] {
  const segment = routeSegment(pathname);
  const path = `/${segment}`;
  const area = AREA_BY_SEGMENT[segment];
  const here = entries.filter((entry) => {
    const route = entry.route?.split("?")[0];
    return route ? route === path : area !== undefined && entry.area === area;
  });
  if (term.trim()) return searchFeatures(term, { ...options, limit: here.length }, here);
  return here.filter((entry) => featureAvailable(entry, options));
}

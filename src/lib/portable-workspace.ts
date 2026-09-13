import { HOTKEY_COMMAND_IDS, useHotkeysStore, validateHotkeyInput } from "@/lib/hotkeys";
import { useObjectFavoritesStore } from "@/lib/object-favorites";
import { useSettingsStore } from "@/lib/settings";
import { useTableColumnPrefs } from "@/lib/table-column-prefs";
import { useViewsStore } from "@/lib/views";

export interface PortableWorkspace {
  format: "l8db-workspace";
  version: 1;
  settings: Record<string, unknown>;
  hotkeys: Record<string, string>;
  layouts: ReturnType<typeof useTableColumnPrefs.getState>["prefs"];
  profiles: ReturnType<typeof useTableColumnPrefs.getState>["profiles"];
  favorites: ReturnType<typeof useObjectFavoritesStore.getState>["favorites"];
  views: ReturnType<typeof useViewsStore.getState>["views"];
}

type Check = (value: unknown) => boolean;
const text: Check = (value) => typeof value === "string" && value.length <= 200_000;
const number: Check = (value) => typeof value === "number" && Number.isFinite(value);
const boolean: Check = (value) => typeof value === "boolean";
const nullable =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);
const array =
  (check: Check): Check =>
  (value) =>
    Array.isArray(value) && value.length <= 10000 && value.every(check);
const record =
  (check: Check): Check =>
  (value) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, entry]) => !["__proto__", "constructor", "prototype"].includes(key) && check(entry),
    );
const shape =
  (required: Record<string, Check>, optional: Record<string, Check> = {}): Check =>
  (value) => {
    if (!record(() => true)(value)) return false;
    const object = value as Record<string, unknown>;
    return (
      Object.entries(required).every(
        ([key, check]) => Object.hasOwn(object, key) && check(object[key]),
      ) &&
      Object.entries(object).every(
        ([key, entry]) => (required[key] ?? optional[key])?.(entry) === true,
      )
    );
  };
const strings = array(text);
const layout = shape({ order: strings, hidden: strings }, { pinned: strings });
const profile = shape({ id: text, name: text, order: strings, hidden: strings, pinned: strings });
const viewState = shape(
  {},
  {
    filter: text,
    filterRaw: boolean,
    sorting: array(shape({ id: text, desc: boolean })),
    page: number,
    detailTab: text,
    filterOpen: boolean,
    filterMode: (value) => value === "simple" || value === "sql",
    filterConditions: array(
      shape({ id: text, column: text, operator: text, value: text }, { dataType: text }),
    ),
    filterCombinator: (value) => value === "AND" || value === "OR",
    filterSql: text,
    columnSizing: record(number),
    scroll: shape({ top: number, left: number, identity: text }),
  },
);
const view = shape(
  { id: text, name: text, filter: text, color: text },
  { filterRaw: boolean, state: viewState, layout },
);
const favorite = shape({
  connectionId: text,
  database: nullable(text),
  schema: text,
  name: text,
  type: (value) => typeof value === "string" && ["table", "view", "matview"].includes(value),
  addedAt: number,
});
const settingEnums: Record<string, string[]> = {
  editorKeywordCase: ["upper", "lower", "preserve"],
  editorFontFamily: ["system", "sf-mono", "menlo", "consolas", "cascadia", "fira", "jetbrains"],
  editorRenderWhitespace: ["none", "boundary", "selection", "trailing", "all"],
  editorWrappingIndent: ["same", "indent", "deepIndent"],
  editorAcceptSuggestionOnEnter: ["on", "smart", "off"],
  editorTabCompletion: ["on", "off", "onlySnippets"],
  uiDensity: ["compact", "normal", "spacious"],
  sslDefaultMode: ["prefer", "require", "disable", "verify-full"],
};
const settingRanges: Record<string, [number, number]> = {
  queryTimeout: [5, 300],
  connectionTimeout: [3, 60],
  rowLimit: [1, 100000],
  uiScale: [50, 200],
  editorFontSize: [6, 72],
  editorTabSize: [1, 16],
  editorLineHeight: [0.5, 5],
  editorMinimapScale: [1, 3],
};
const settingKeys = Object.keys(useSettingsStore.getState()).filter(
  (key) =>
    !key.startsWith("set") &&
    !key.startsWith("reset") &&
    typeof useSettingsStore.getState()[
      key as keyof ReturnType<typeof useSettingsStore.getState>
    ] !== "function",
);

export function exportPortableWorkspace(): PortableWorkspace {
  const state = useSettingsStore.getState() as unknown as Record<string, unknown>;
  return JSON.parse(
    JSON.stringify({
      format: "l8db-workspace",
      version: 1,
      settings: Object.fromEntries(settingKeys.map((key) => [key, state[key]])),
      hotkeys: useHotkeysStore.getState().overrides,
      layouts: useTableColumnPrefs.getState().prefs,
      profiles: useTableColumnPrefs.getState().profiles,
      favorites: useObjectFavoritesStore.getState().favorites,
      views: useViewsStore.getState().views,
    }),
  );
}

export function parsePortableWorkspace(source: string): PortableWorkspace {
  if (new TextEncoder().encode(source).length > 5 * 1024 * 1024)
    throw new Error("Arbeitsumgebung ist größer als 5 MiB.");
  const value: unknown = JSON.parse(source, (key, entry) => {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new Error("Ungültiger Schlüssel in der Arbeitsumgebung.");
    return entry;
  });
  const current = useSettingsStore.getState() as unknown as Record<string, unknown>;
  const settings: Check = (candidate) =>
    record(() => true)(candidate) &&
    Object.entries(candidate as Record<string, unknown>).every(([key, entry]) => {
      if (!settingKeys.includes(key)) return false;
      if (settingEnums[key]) return typeof entry === "string" && settingEnums[key].includes(entry);
      if (settingRanges[key])
        return (
          (key === "editorLineHeight" || Number.isInteger(entry)) &&
          number(entry) &&
          Number(entry) >= settingRanges[key][0] &&
          Number(entry) <= settingRanges[key][1]
        );
      if (key === "editorRulers")
        return array((item) => number(item) && Number(item) >= 1 && Number(item) <= 1000)(entry);
      if (key === "hiddenTableDetailTabs") return array(text)(entry);
      if (key === "skippedUpdateVersion") return nullable(text)(entry);
      const example = current[key];
      if (Array.isArray(example))
        return array((item) => typeof item === "string" || number(item))(entry);
      if (example === null) return nullable(text)(entry);
      if (typeof example === "number")
        return number(entry) && Number(entry) >= 0 && Number(entry) <= 1_000_000;
      return typeof entry === typeof example && (typeof entry !== "string" || entry.length < 1000);
    });
  if (
    !shape({
      format: (entry) => entry === "l8db-workspace",
      version: (entry) => entry === 1,
      settings,
      hotkeys: (entry) =>
        record((value) => typeof value === "string" && validateHotkeyInput(value).valid)(entry) &&
        Object.keys(entry as object).every((key) => HOTKEY_COMMAND_IDS.includes(key)),
      layouts: record(layout),
      profiles: record(array(profile)),
      favorites: array(favorite),
      views: record(array(view)),
    })(value)
  )
    throw new Error("Ungültige oder nicht unterstützte Arbeitsumgebung.");
  return value as PortableWorkspace;
}

export function applyPortableWorkspace(value: PortableWorkspace): () => void {
  const validated = parsePortableWorkspace(JSON.stringify(value));
  const before = exportPortableWorkspace();
  const write = (workspace: PortableWorkspace) => {
    useSettingsStore.setState(workspace.settings);
    useHotkeysStore.setState({ overrides: workspace.hotkeys });
    useTableColumnPrefs.setState({ prefs: workspace.layouts, profiles: workspace.profiles });
    useObjectFavoritesStore.setState({ favorites: workspace.favorites });
    useViewsStore.setState({ views: workspace.views });
  };
  try {
    write(validated);
  } catch (error) {
    write(before);
    throw error;
  }
  return () => write(before);
}

import type {
  ColumnPatch,
  DetailTab,
  OptionSpec,
  OptionValues,
  Slots,
  SplitLayout,
  SplitOptions,
  TabGroup,
  TabsOptions,
  Template,
  Tone,
  ToolbarAction,
} from "../l8db-ui";

export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}(\.[a-z0-9][a-z0-9-]{0,40}){1,3}$/;

export const TONES: readonly Tone[] = ["neutral", "info", "success", "warning", "danger"];

export const SPLIT_LAYOUTS: readonly SplitLayout[] = [
  "columns",
  "rows",
  "leftStack",
  "topStack",
  "grid",
];

const OPTION_KEY = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;
const TABLE_NAME = /^[^.\s][^.]*\.[^.]*[^.\s]$/;

const SLOT_KEYS: Record<string, readonly string[]> = {
  grid: ["columns", "cell", "rowTone"],
  table: ["toolbar", "detailTabs"],
  tabs: ["group", "item", "options"],
  split: ["layout", "options", "templates"],
};

const STATIC_SLOTS = new Set(["tabs.options", "split.options", "split.templates"]);

export type HttpPattern = { host: string; port: string | null; path: string };

export type PluginDefinition = {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  http: string[];
  options: Record<string, OptionSpec>;
  slots: Slots | ((options: OptionValues) => Slots);
};

export class PluginDefinitionError extends Error {}

function fail(message: string): never {
  throw new PluginDefinitionError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownKeys(value: Record<string, unknown>) {
  return Object.keys(value).filter((key) => key !== "__proto__");
}

function optionalText(value: unknown, path: string, max: number): string {
  if (value === undefined) return "";
  if (typeof value !== "string") fail(`${path} muss ein Text sein.`);
  if (value.length > max) fail(`${path} darf höchstens ${max} Zeichen haben.`);
  return value;
}

function requiredText(value: unknown, path: string, max: number): string {
  const text = optionalText(value, path, max);
  if (!text.trim()) fail(`${path} fehlt.`);
  return text;
}

export function parseHttpPattern(entry: string): HttpPattern | null {
  const trimmed = entry.trim();
  if (!trimmed || trimmed.length > 300) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https:\/\//i.test(trimmed)) return null;
  const rest = trimmed.replace(/^https:\/\//i, "");
  const slash = rest.indexOf("/");
  const authority = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase();
  const path = slash < 0 ? "/" : rest.slice(slash);
  const match = /^(\*\.)?([a-z0-9-]+(\.[a-z0-9-]+)*)(:(\d{1,5}))?$/.exec(authority);
  if (!match || /[?#\s]/.test(path)) return null;
  return { host: `${match[1] ?? ""}${match[2]}`, port: match[5] ?? null, path };
}

export function formatHttpPattern(pattern: HttpPattern): string {
  return `${pattern.host}${pattern.port ? `:${pattern.port}` : ""}${pattern.path === "/" ? "" : pattern.path}`;
}

export function httpPatternMatches(pattern: string, url: string): boolean {
  const parsed = parseHttpPattern(pattern);
  if (!parsed) return false;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.protocol !== "https:" || target.username || target.password) return false;
  const host = target.hostname.toLowerCase();
  const hostOk = parsed.host.startsWith("*.")
    ? host.endsWith(parsed.host.slice(1)) && host.length > parsed.host.length - 1
    : host === parsed.host;
  const port = target.port || "443";
  const portOk = (parsed.port ?? "443") === port;
  const path = target.pathname;
  const pathOk =
    parsed.path === "/" ||
    (!/%2e|%2f|%5c/i.test(path) &&
      (path === parsed.path ||
        path.startsWith(parsed.path.endsWith("/") ? parsed.path : `${parsed.path}/`)));
  return hostOk && portOk && pathOk;
}

function validateOption(key: string, value: unknown): OptionSpec {
  const path = `options.${key}`;
  if (!isRecord(value)) fail(`${path} muss ein Objekt sein.`);
  const label = requiredText(value.label, `${path}.label`, 80);
  const description = optionalText(value.description, `${path}.description`, 300) || undefined;
  if (value.type === "boolean") {
    if (value.default !== undefined && typeof value.default !== "boolean")
      fail(`${path}.default muss true oder false sein.`);
    return { type: "boolean", label, description, default: value.default as boolean | undefined };
  }
  if (value.type === "text") {
    return {
      type: "text",
      label,
      description,
      default: optionalText(value.default, `${path}.default`, 500),
      placeholder: optionalText(value.placeholder, `${path}.placeholder`, 120) || undefined,
    };
  }
  if (value.type === "number") {
    for (const field of ["default", "min", "max", "step"] as const)
      if (
        value[field] !== undefined &&
        (typeof value[field] !== "number" || !Number.isFinite(value[field]))
      )
        fail(`${path}.${field} muss eine Zahl sein.`);
    return {
      type: "number",
      label,
      description,
      default: value.default as number | undefined,
      min: value.min as number | undefined,
      max: value.max as number | undefined,
      step: value.step as number | undefined,
    };
  }
  if (value.type === "select") {
    if (!Array.isArray(value.choices) || value.choices.length === 0 || value.choices.length > 50)
      fail(`${path}.choices braucht 1 bis 50 Einträge.`);
    const choices = value.choices.map((choice, index) => {
      if (typeof choice === "string") return choice;
      if (!isRecord(choice))
        fail(`${path}.choices[${index}] muss Text oder { value, label } sein.`);
      return {
        value: requiredText(choice.value, `${path}.choices[${index}].value`, 120),
        label: requiredText(choice.label, `${path}.choices[${index}].label`, 120),
      };
    });
    const values = choices.map((choice) => (typeof choice === "string" ? choice : choice.value));
    if (value.default !== undefined && !values.includes(value.default as string))
      fail(`${path}.default muss einer der choices sein.`);
    return {
      type: "select",
      label,
      description,
      default: value.default as string | undefined,
      choices,
    };
  }
  return fail(`${path}.type muss "boolean", "text", "number" oder "select" sein.`);
}

export function validateTemplate(value: unknown, path: string): Template {
  if (!isRecord(value)) fail(`${path} muss ein Objekt sein.`);
  const id = requiredText(value.id, `${path}.id`, 40);
  if (!ITEM_ID.test(id)) fail(`${path}.id darf nur Buchstaben, Ziffern, - und _ enthalten.`);
  const name = requiredText(value.name, `${path}.name`, 60);
  if (
    value.orientation !== undefined &&
    value.orientation !== "horizontal" &&
    value.orientation !== "vertical"
  )
    fail(`${path}.orientation muss "horizontal" oder "vertical" sein.`);
  if (!Array.isArray(value.panes) || value.panes.length < 2 || value.panes.length > 4)
    fail(`${path}.panes braucht 2 bis 4 Bereiche.`);
  const panes = value.panes.map((pane, index) => {
    const panePath = `${path}.panes[${index}]`;
    if (!isRecord(pane)) fail(`${panePath} muss ein Objekt sein.`);
    const table = requiredText(pane.table, `${panePath}.table`, 200);
    if (!TABLE_NAME.test(table)) fail(`${panePath}.table muss "schema.tabelle" sein.`);
    if (
      pane.master !== undefined &&
      (!Number.isInteger(pane.master) ||
        (pane.master as number) < 0 ||
        (pane.master as number) >= index)
    )
      fail(`${panePath}.master muss der Index eines früheren Bereichs sein.`);
    let link: Template["panes"][number]["link"];
    if (pane.link !== undefined) {
      if (pane.master === undefined) fail(`${panePath}.link braucht master.`);
      if (!isRecord(pane.link)) fail(`${panePath}.link muss { column, masterColumn? } sein.`);
      link = {
        column: requiredText(pane.link.column, `${panePath}.link.column`, 120),
        masterColumn:
          optionalText(pane.link.masterColumn, `${panePath}.link.masterColumn`, 120) || undefined,
      };
    }
    return { table, master: pane.master as number | undefined, link };
  });
  let when: Template["when"];
  if (value.when !== undefined) {
    if (!isRecord(value.when)) fail(`${path}.when muss ein Objekt sein.`);
    const list = (entry: unknown, field: string) => {
      if (entry === undefined) return undefined;
      const items = Array.isArray(entry) ? entry : [entry];
      if (items.length === 0 || items.some((item) => typeof item !== "string" || !item.trim()))
        fail(`${path}.when.${field} muss Text oder eine Liste von Texten sein.`);
      return items as string[];
    };
    when = {
      connectionTag: list(value.when.connectionTag, "connectionTag"),
      connectionName: list(value.when.connectionName, "connectionName"),
    };
  }
  return {
    id,
    name,
    when,
    orientation: value.orientation as Template["orientation"],
    panes,
  };
}

function validateTabsOptions(value: unknown): TabsOptions {
  if (!isRecord(value)) fail("slots.tabs.options muss ein Objekt sein.");
  for (const key of ownKeys(value))
    if (key !== "closeButton" && key !== "newTabPosition")
      fail(`Unbekannte Option slots.tabs.options.${key}. Erlaubt: closeButton, newTabPosition.`);
  if (
    value.closeButton !== undefined &&
    !["auto", "always", "hover", "never"].includes(value.closeButton as string)
  )
    fail('slots.tabs.options.closeButton muss "auto", "always", "hover" oder "never" sein.');
  if (
    value.newTabPosition !== undefined &&
    !["end", "afterActive"].includes(value.newTabPosition as string)
  )
    fail('slots.tabs.options.newTabPosition muss "end" oder "afterActive" sein.');
  return value as TabsOptions;
}

function validateSplitOptions(value: unknown): SplitOptions {
  if (!isRecord(value)) fail("slots.split.options muss ein Objekt sein.");
  for (const key of ownKeys(value))
    if (key !== "autoSaveGroups")
      fail(`Unbekannte Option slots.split.options.${key}. Erlaubt: autoSaveGroups.`);
  if (value.autoSaveGroups !== undefined && typeof value.autoSaveGroups !== "boolean")
    fail("slots.split.options.autoSaveGroups muss true oder false sein.");
  return value as SplitOptions;
}

export function validateSlots(value: unknown): Slots {
  if (!isRecord(value)) fail("slots muss ein Objekt sein, z. B. { grid: { cell } }.");
  const slots: Record<string, Record<string, unknown>> = {};
  for (const group of ownKeys(value)) {
    const allowed = SLOT_KEYS[group];
    if (!allowed) fail(`Unbekannte Slot-Gruppe "${group}". Erlaubt: grid, table, tabs, split.`);
    const entries = value[group];
    if (entries === undefined) continue;
    if (!isRecord(entries)) fail(`slots.${group} muss ein Objekt sein.`);
    const normalized: Record<string, unknown> = {};
    for (const key of ownKeys(entries)) {
      if (!allowed.includes(key))
        fail(
          `Unbekannter Slot "${group}.${key}". Erlaubt: ${allowed.map((name) => `${group}.${name}`).join(", ")}.`,
        );
      const slot = entries[key];
      if (slot === undefined) continue;
      const name = `${group}.${key}`;
      if (STATIC_SLOTS.has(name)) {
        if (name === "tabs.options") normalized[key] = validateTabsOptions(slot);
        else if (name === "split.options") normalized[key] = validateSplitOptions(slot);
        else {
          if (!Array.isArray(slot) || slot.length > 20)
            fail("slots.split.templates braucht eine Liste mit höchstens 20 Vorlagen.");
          const templates = slot.map((template, index) =>
            validateTemplate(template, `slots.split.templates[${index}]`),
          );
          const ids = new Set(templates.map((template) => template.id));
          if (ids.size !== templates.length) fail("slots.split.templates enthält doppelte ids.");
          normalized[key] = templates;
        }
      } else if (typeof slot !== "function") fail(`slots.${name} muss eine Funktion sein.`);
      else normalized[key] = slot;
    }
    slots[group] = normalized;
  }
  return slots as Slots;
}

export function validatePlugin(value: unknown): PluginDefinition {
  if (!isRecord(value))
    fail('Die Datei muss "export default definePlugin({ id, slots })" enthalten.');
  for (const key of ownKeys(value))
    if (
      ![
        "id",
        "name",
        "description",
        "version",
        "author",
        "permissions",
        "options",
        "slots",
      ].includes(key)
    )
      fail(
        `Unbekanntes Feld "${key}". Erlaubt: id, name, description, version, author, permissions, options, slots.`,
      );
  const id = requiredText(value.id, "id", 120);
  if (!PLUGIN_ID_PATTERN.test(id))
    fail(
      'id muss wie "herausgeber.name" aussehen: Kleinbuchstaben, Ziffern und -, getrennt durch Punkte.',
    );
  const http: string[] = [];
  if (value.permissions !== undefined) {
    if (!isRecord(value.permissions)) fail("permissions muss ein Objekt sein.");
    for (const key of ownKeys(value.permissions))
      if (key !== "http") fail(`Unbekannte Berechtigung "${key}". Erlaubt: http.`);
    const entries = value.permissions.http;
    if (entries !== undefined) {
      if (!Array.isArray(entries) || entries.length > 20)
        fail("permissions.http muss eine Liste mit höchstens 20 Zielen sein.");
      for (const entry of entries) {
        const parsed = typeof entry === "string" ? parseHttpPattern(entry) : null;
        if (!parsed)
          fail(
            `permissions.http: "${String(entry)}" ist kein gültiges HTTPS-Ziel wie "https://api.example.com/pfad".`,
          );
        http.push(formatHttpPattern(parsed));
      }
    }
  }
  const options: Record<string, OptionSpec> = {};
  if (value.options !== undefined) {
    if (!isRecord(value.options)) fail("options muss ein Objekt sein.");
    const keys = ownKeys(value.options);
    if (keys.length > 30) fail("options darf höchstens 30 Einträge haben.");
    for (const key of keys) {
      if (!OPTION_KEY.test(key))
        fail(`options.${key}: Schlüssel nur aus Buchstaben, Ziffern und _.`);
      options[key] = validateOption(key, value.options[key]);
    }
  }
  if (value.slots === undefined) fail("slots fehlt.");
  const slots =
    typeof value.slots === "function"
      ? (value.slots as (options: OptionValues) => Slots)
      : validateSlots(value.slots);
  return {
    id,
    name: optionalText(value.name, "name", 80) || id,
    description: optionalText(value.description, "description", 500),
    version: optionalText(value.version, "version", 40),
    author: optionalText(value.author, "author", 80),
    http: [...new Set(http)],
    options,
    slots,
  };
}

export function resolveOptions(
  specs: Record<string, OptionSpec>,
  stored: Readonly<Record<string, unknown>> | undefined,
): OptionValues {
  const values: Record<string, string | number | boolean> = {};
  for (const [key, spec] of Object.entries(specs)) {
    const saved = stored?.[key];
    if (spec.type === "boolean")
      values[key] = typeof saved === "boolean" ? saved : (spec.default ?? false);
    else if (spec.type === "text")
      values[key] = typeof saved === "string" ? saved.slice(0, 500) : (spec.default ?? "");
    else if (spec.type === "number") {
      const fallback = spec.default ?? spec.min ?? 0;
      const number = typeof saved === "number" && Number.isFinite(saved) ? saved : fallback;
      values[key] = Math.min(
        spec.max ?? Number.POSITIVE_INFINITY,
        Math.max(spec.min ?? Number.NEGATIVE_INFINITY, number),
      );
    } else {
      const choices = spec.choices.map((choice) =>
        typeof choice === "string" ? choice : choice.value,
      );
      values[key] =
        typeof saved === "string" && choices.includes(saved) ? saved : (spec.default ?? choices[0]);
    }
  }
  return Object.freeze(values);
}

export function validateTone(value: unknown): Tone | undefined {
  if (value === undefined || value === null) return undefined;
  if (!TONES.includes(value as Tone))
    fail(`Ton "${String(value)}" gibt es nicht. Erlaubt: ${TONES.join(", ")}.`);
  return value as Tone;
}

export function validateColumnPatches(value: unknown): ColumnPatch[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail("grid.columns muss eine Liste von Patches liefern.");
  return value.slice(0, 500).map((patch, index) => {
    const path = `grid.columns()[${index}]`;
    if (!isRecord(patch)) fail(`${path} muss ein Objekt sein.`);
    const id = requiredText(patch.id, `${path}.id`, 200);
    for (const field of ["hidden", "pinned"] as const)
      if (patch[field] !== undefined && typeof patch[field] !== "boolean")
        fail(`${path}.${field} muss true oder false sein.`);
    if (
      patch.order !== undefined &&
      (typeof patch.order !== "number" || !Number.isFinite(patch.order))
    )
      fail(`${path}.order muss eine Zahl sein.`);
    if (
      patch.width !== undefined &&
      (typeof patch.width !== "number" || patch.width < 40 || patch.width > 1200)
    )
      fail(`${path}.width muss zwischen 40 und 1200 liegen.`);
    if (patch.align !== undefined && !["start", "center", "end"].includes(patch.align as string))
      fail(`${path}.align muss "start", "center" oder "end" sein.`);
    return {
      id,
      hidden: patch.hidden as boolean | undefined,
      pinned: patch.pinned as boolean | undefined,
      order: patch.order as number | undefined,
      width: patch.width as number | undefined,
      label: optionalText(patch.label, `${path}.label`, 80) || undefined,
      align: patch.align as ColumnPatch["align"],
    };
  });
}

export function validateToolbarActions(value: unknown): ToolbarAction[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 12)
    fail("table.toolbar muss eine Liste mit höchstens 12 Aktionen liefern.");
  return value.map((action, index) => {
    const path = `table.toolbar()[${index}]`;
    if (!isRecord(action)) fail(`${path} muss ein Objekt sein.`);
    const id = requiredText(action.id, `${path}.id`, 40);
    if (!ITEM_ID.test(id)) fail(`${path}.id darf nur Buchstaben, Ziffern, - und _ enthalten.`);
    if (typeof action.run !== "function") fail(`${path}.run muss eine Funktion sein.`);
    return {
      id,
      label: requiredText(action.label, `${path}.label`, 40),
      tone: validateTone(action.tone),
      run: action.run as ToolbarAction["run"],
    };
  });
}

export function validateDetailTabs(value: unknown): DetailTab[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 8)
    fail("table.detailTabs muss eine Liste mit höchstens 8 Tabs liefern.");
  return value.map((tab, index) => {
    const path = `table.detailTabs()[${index}]`;
    if (!isRecord(tab)) fail(`${path} muss ein Objekt sein.`);
    const id = requiredText(tab.id, `${path}.id`, 40);
    if (!ITEM_ID.test(id)) fail(`${path}.id darf nur Buchstaben, Ziffern, - und _ enthalten.`);
    if (typeof tab.render !== "function") fail(`${path}.render muss eine Funktion sein.`);
    return {
      id,
      label: requiredText(tab.label, `${path}.label`, 40),
      render: tab.render as DetailTab["render"],
    };
  });
}

export function validateTabGroup(value: unknown): TabGroup | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) fail("tabs.group muss { id, label } oder undefined liefern.");
  return {
    id: requiredText(value.id, "tabs.group().id", 80),
    label: requiredText(value.label, "tabs.group().label", 40),
    tone: validateTone(value.tone),
  };
}

export function validateSplitLayout(value: unknown): SplitLayout | undefined {
  if (value === undefined || value === null) return undefined;
  if (!SPLIT_LAYOUTS.includes(value as SplitLayout))
    fail(`split.layout muss einer von ${SPLIT_LAYOUTS.join(", ")} sein.`);
  return value as SplitLayout;
}

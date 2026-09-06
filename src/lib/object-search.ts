import type { FunctionInfo, TableInfo } from "@/lib/db";

export type ObjectEntryType = "table" | "view" | "routine";

export interface ObjectEntry {
  type: ObjectEntryType;
  schema: string;
  name: string;
  detail: string;
  oid?: string;
  key: string;
}

export interface ObjectSourceLists {
  tables?: TableInfo[];
  views?: TableInfo[];
  functions?: FunctionInfo[];
}

export const OBJECT_TYPE_LABEL: Record<ObjectEntryType, string> = {
  table: "Tabelle",
  view: "View",
  routine: "Routine",
};

export const OBJECT_TYPE_PLURAL: Record<ObjectEntryType, string> = {
  table: "Tabellen",
  view: "Views",
  routine: "Routinen",
};

function entryKey(type: ObjectEntryType, schema: string, name: string, detail: string): string {
  return `${type}:${schema}.${name}${detail ? `(${detail})` : ""}`;
}

export function buildObjectEntries(lists: ObjectSourceLists): ObjectEntry[] {
  const entries: ObjectEntry[] = [];
  for (const table of lists.tables ?? []) {
    entries.push({
      type: "table",
      schema: table.schema,
      name: table.name,
      detail: "",
      key: entryKey("table", table.schema, table.name, ""),
    });
  }
  for (const view of lists.views ?? []) {
    entries.push({
      type: "view",
      schema: view.schema,
      name: view.name,
      detail: "",
      key: entryKey("view", view.schema, view.name, ""),
    });
  }
  for (const fn of lists.functions ?? []) {
    entries.push({
      type: "routine",
      schema: fn.schema,
      name: fn.name,
      detail: fn.identity_args,
      oid: fn.oid,
      key: entryKey("routine", fn.schema, fn.name, fn.identity_args),
    });
  }
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
}

export function objectEntryKeywords(entry: ObjectEntry): string[] {
  const keywords = [
    entry.schema,
    `${entry.schema}.${entry.name}`,
    OBJECT_TYPE_LABEL[entry.type],
    entry.type,
  ];
  if (entry.detail) keywords.push(entry.detail);
  return keywords;
}

export function objectEntryHint(entry: ObjectEntry): string {
  const base = `${OBJECT_TYPE_LABEL[entry.type]} · ${entry.schema}`;
  return entry.detail ? `${base}(${entry.detail})` : base;
}

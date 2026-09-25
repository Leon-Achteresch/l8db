import type { CatalogObject, CatalogObjectType, DatabaseKind } from "@/lib/db";
import type { CompareContext, DiffItem, DiffStatus, SchemaCompareOptions } from "./types";
import { TYPE_ORDER } from "./types";

export const CONTAINER_TYPES = new Set<CatalogObjectType>(["table", "materialized_view"]);
const CHILD_TYPES = new Set<CatalogObjectType>([
  "column",
  "constraint",
  "index",
  "trigger",
  "comment",
  "grant",
  "sequence",
]);
const ATTRIBUTE_TYPES = new Set<CatalogObjectType>(["table", "column", "sequence"]);
const STATUS_ATTRIBUTES = ["status"];

export const ATTRIBUTE_LABELS: Record<string, string> = {
  type: "Datentyp",
  nullable: "Nullable",
  default: "Default",
  virtual: "Virtuell",
  identity: "Identity",
  generated: "Generiert",
  collation: "Collation",
  start: "Startwert",
  current: "Aktueller Wert",
  increment: "Inkrement",
  min: "Minimum",
  max: "Maximum",
  cache: "Cache",
  cycle: "Zyklus",
  order: "Order",
  temporary: "Temporär",
  partitioned: "Partitionierung",
  partition_key: "Partitionsschlüssel",
  partition_of: "Partition von",
  organization: "Organisation",
  unlogged: "Unlogged",
  status: "Status",
  owned_column: "Besitzer-Spalte",
  on_update: "ON UPDATE",
};

const SETTING_CONTEXT = /\b(?:SET\s+(?:(?:LOCAL|SESSION)\s+)?|RESET\s+)$/i;
const TOKEN =
  /--[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"]|"")*"|[nN]?[qQ]'(?:\[[\s\S]*?\]|\{[\s\S]*?\}|\([\s\S]*?\)|<[\s\S]*?>|(\S)[\s\S]*?\1)'|[eE]'(?:[^'\\]|\\.|'')*'|'(?:[^']|'')*'/g;
const SQL_TEXT =
  /\b(?:select|from|join|into|update|delete|insert|table|view|truncate|call|execute|alter|drop|create|merge|references)\b/i;

function plainIdentifier(name: string, kind: DatabaseKind): boolean {
  if (kind === "oracle") return /^[A-Z][A-Z0-9_$#]*$/.test(name);
  if (kind === "postgres") return /^[a-z_][a-z0-9_$]*$/.test(name);
  return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(name);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function quoteName(name: string, kind?: DatabaseKind | null): string {
  if (kind === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  if (kind === "mssql") return `[${name.replace(/]/g, "]]")}]`;
  return `"${name.replace(/"/g, '""')}"`;
}

function requalifyCode(sql: string, from: string, to: string, kind: DatabaseKind): string {
  const quotedTo = `${quoteName(to, kind)}.`;
  let out = sql.split(`${quoteName(from, kind)}.`).join(quotedTo);
  if (plainIdentifier(from, kind)) {
    const bareTo = plainIdentifier(to, kind) ? `${to}.` : quotedTo;
    out = out.replace(
      new RegExp(`(^|[^\\w$#."\`\\[\\]])${escapeRegExp(from)}\\.`, "gi"),
      (match, before: string, offset: number, text: string) =>
        kind === "postgres" &&
        SETTING_CONTEXT.test(text.slice(Math.max(0, offset - 40), offset + before.length))
          ? match
          : `${before}${bareTo}`,
    );
  }
  return out;
}

export function requalify(sql: string, from: string, to: string, kind: DatabaseKind): string {
  if (!from || from === to) return sql;
  let out = "";
  let code = 0;
  for (const match of sql.matchAll(TOKEN)) {
    const token = match[0];
    if (!token.endsWith("'") || /^(?:--|\/\*|")/.test(token)) continue;
    const start = match.index ?? 0;
    const end = start + token.length;
    const rewrite =
      SQL_TEXT.test(token) ||
      /^\s*::\s*reg/i.test(sql.slice(end, end + 12)) ||
      /\bto_reg\w*\s*\(\s*$/i.test(sql.slice(Math.max(0, start - 30), start));
    out += requalifyCode(sql.slice(code, start), from, to, kind);
    out += rewrite ? requalifyCode(token, from, to, kind) : token;
    code = end;
  }
  return out + requalifyCode(sql.slice(code), from, to, kind);
}

function requalifyObject(
  object: CatalogObject,
  from: string,
  to: string,
  kind: DatabaseKind,
): CatalogObject {
  if (from === to) return object;
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(object.attributes))
    attributes[key] = requalify(value, from, to, kind);
  const routine = object.object_type === "function" || object.object_type === "procedure";
  return {
    ...object,
    name: routine ? requalify(object.name, from, to, kind) : object.name,
    ddl: requalify(object.ddl, from, to, kind),
    attributes,
  };
}

export function canonical(
  text: string,
  schema: string,
  kind: DatabaseKind,
  options: SchemaCompareOptions,
): string {
  let out = requalify(text, schema, "§", kind)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
    .replace(/[;\s/]+$/, "");
  if (options.ignoreWhitespace) out = out.replace(/\s+/g, " ");
  if (options.ignoreCase) out = out.toLowerCase();
  return out;
}

function comparableAttributes(object: CatalogObject, context: CompareContext) {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(object.attributes)) {
    if (key === "current" && context.options.ignoreSequenceValues) continue;
    values[key] = canonical(value, context.targetSchema, context.kind, context.options);
  }
  return values;
}

function differingAttributes(a: Record<string, string>, b: Record<string, string>): string[] {
  const order = Object.keys(ATTRIBUTE_LABELS);
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(
    (x, y) => rank(x) - rank(y) || x.localeCompare(y),
  );
  return keys.filter((key) => (a[key] ?? "") !== (b[key] ?? ""));
}

function definitionOf(object: CatalogObject): string {
  if (object.object_type === "constraint" || object.object_type === "index")
    return object.attributes.definition ?? object.ddl;
  return object.ddl;
}

export function differences(
  source: CatalogObject,
  target: CatalogObject,
  context: CompareContext,
): string[] {
  if (ATTRIBUTE_TYPES.has(source.object_type))
    return differingAttributes(
      comparableAttributes(source, context),
      comparableAttributes(target, context),
    ).map((key) => ATTRIBUTE_LABELS[key] ?? key);
  const out: string[] = [];
  const text = (object: CatalogObject) =>
    canonical(definitionOf(object), context.targetSchema, context.kind, context.options);
  if (text(source) !== text(target)) out.push("Definition");
  for (const key of STATUS_ATTRIBUTES)
    if ((source.attributes[key] ?? "") !== (target.attributes[key] ?? ""))
      out.push(ATTRIBUTE_LABELS[key] ?? key);
  return out;
}

export function objectKey(object: CatalogObject, context: CompareContext): string {
  const base = `${object.object_type}|${object.parent ?? ""}|`;
  if (
    context.options.ignoreSystemNames &&
    object.attributes.generated === "YES" &&
    object.attributes.definition
  )
    return `${base}#${canonical(object.attributes.definition, context.targetSchema, context.kind, context.options)}`;
  return `${base}${object.name}`;
}

function typeRank(type: CatalogObjectType): number {
  return TYPE_ORDER.indexOf(type);
}

export function compareCatalogs(
  source: CatalogObject[],
  target: CatalogObject[],
  context: CompareContext,
): DiffItem[] {
  const src = source.map((object) =>
    requalifyObject(object, context.sourceSchema, context.targetSchema, context.kind),
  );
  const containers = (list: CatalogObject[]) =>
    new Set(list.filter((item) => CONTAINER_TYPES.has(item.object_type)).map((item) => item.name));
  const sourceContainers = containers(src);
  const targetContainers = containers(target);
  const onlySource = new Set([...sourceContainers].filter((name) => !targetContainers.has(name)));
  const onlyTarget = new Set([...targetContainers].filter((name) => !sourceContainers.has(name)));
  const children = new Map<string, CatalogObject[]>();
  const sourceChildren = new Map<string, CatalogObject[]>();
  for (const object of src) {
    if (!CHILD_TYPES.has(object.object_type) || !object.parent) continue;
    const list = sourceChildren.get(object.parent) ?? [];
    list.push(object);
    sourceChildren.set(object.parent, list);
  }
  const index = (list: CatalogObject[], side: "s" | "t", exclusive: Set<string>) => {
    const map = new Map<string, CatalogObject>();
    for (const object of list) {
      if (CHILD_TYPES.has(object.object_type) && object.parent && exclusive.has(object.parent)) {
        const key = `${side}|${object.parent}`;
        const list = children.get(key) ?? [];
        list.push(object);
        children.set(key, list);
        continue;
      }
      let key = objectKey(object, context);
      while (map.has(key)) key = `${key}~`;
      map.set(key, object);
    }
    return map;
  };
  const left = index(src, "s", onlySource);
  const right = index(target, "t", onlyTarget);
  const items: DiffItem[] = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key) ?? null;
    const b = right.get(key) ?? null;
    const base = (a ?? b) as CatalogObject;
    let status: DiffStatus = a ? "only_source" : "only_target";
    let differsBy: string[] = [];
    if (a && b) {
      differsBy = differences(a, b, context);
      status = differsBy.length > 0 ? "different" : "identical";
    }
    let related: CatalogObject[] = [];
    if (CONTAINER_TYPES.has(base.object_type)) {
      if (status === "only_source") related = children.get(`s|${base.name}`) ?? [];
      else if (status === "only_target") related = children.get(`t|${base.name}`) ?? [];
      else related = sourceChildren.get(base.name) ?? [];
    }
    items.push({
      key,
      type: base.object_type,
      name: base.name,
      parent: base.parent,
      status,
      source: a,
      target: b,
      differsBy,
      children: related,
    });
  }
  return items.sort(
    (a, b) =>
      typeRank(a.type) - typeRank(b.type) ||
      (a.parent ?? "").localeCompare(b.parent ?? "") ||
      a.name.localeCompare(b.name),
  );
}

export function defaultSelection(items: DiffItem[]): Record<string, boolean> {
  const selection: Record<string, boolean> = {};
  for (const item of items)
    if (item.status === "only_source" || item.status === "different") selection[item.key] = true;
  return selection;
}

export function detailText(item: DiffItem, side: "source" | "target", items: DiffItem[]): string {
  const object = side === "source" ? item.source : item.target;
  if (!object) return "";
  if (item.type === "column" || item.type === "sequence") {
    const attributes = Object.entries(object.attributes)
      .map(([key, value]) => `-- ${ATTRIBUTE_LABELS[key] ?? key}: ${value}`)
      .join("\n");
    return `${object.ddl}\n\n${attributes}`;
  }
  let related: CatalogObject[] = [];
  if (CONTAINER_TYPES.has(item.type))
    related =
      item.status === "only_source" || item.status === "only_target"
        ? item.children
        : items
            .filter((other) => other.parent === item.name && CHILD_TYPES.has(other.type))
            .map((other) => (side === "source" ? other.source : other.target))
            .filter((child): child is CatalogObject => child !== null);
  const parts = [
    object.ddl,
    ...related.filter((child) => child.object_type !== "column").map((child) => child.ddl),
  ];
  if (object.attributes.status === "DISABLED") parts.push("-- Status: DISABLED");
  return parts.join("\n\n");
}

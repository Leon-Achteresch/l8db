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
  tablespace: "Tablespace",
};

export const COLUMN_ORDER = "Spaltenreihenfolge";

const SETTING_CONTEXT = /\b(?:SET\s+(?:(?:LOCAL|SESSION)\s+)?|RESET\s+)$/i;
const TOKEN =
  /--[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"]|"")*"|[nN]?[qQ]'(?:\[[\s\S]*?\]|\{[\s\S]*?\}|\([\s\S]*?\)|<[\s\S]*?>|(\S)[\s\S]*?\1)'|[eE]'(?:[^'\\]|\\.|'')*'|'(?:[^']|'')*'/g;
const CANONICAL_TOKEN: Partial<Record<DatabaseKind, RegExp>> = {
  mysql:
    /--[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|`(?:[^`]|``)*`|"(?:[^"\\]|\\[\s\S]|"")*"|'(?:[^'\\]|\\[\s\S]|'')*'/g,
  mssql: /--[^\n]*|\/\*[\s\S]*?\*\/|\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[nN]?'(?:[^']|'')*'/g,
  postgres: new RegExp(
    `${TOKEN.source}|\\$(?!function\\$)([A-Za-z_]\\w*)?\\$[\\s\\S]*?\\$\\2\\$`,
    "g",
  ),
};
const SQL_TEXT =
  /\b(?:select|from|join|into|update|delete|insert|table|view|truncate|call|execute|alter|drop|create|merge|references)\b/i;

const KEYWORDS = new Set(
  (
    "access add all alter and any as asc between by case cast check column comment connect constraint " +
    "create cross current current_date current_role current_schema current_time current_timestamp " +
    "current_user date default delete desc distinct drop else end exists false fetch for foreign from " +
    "full grant group having identity in index inner insert intersect interval into is join key left " +
    "level like limit localtime localtimestamp minus natural not null offset on or order outer primary " +
    "references right rowid rownum select session_user set some sysdate systimestamp table then time " +
    "timestamp to trigger true uid union unique update user using values view when where with"
  ).split(" "),
);

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
    ...(object.depends_on
      ? { depends_on: object.depends_on.map((name) => requalify(name, from, to, kind)) }
      : {}),
  };
}

export function canonical(
  text: string,
  schema: string,
  kind: DatabaseKind,
  options: SchemaCompareOptions,
): string {
  const out = requalify(text, schema, "§", kind)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
    .replace(/[;\s/]+$/, "");
  if (
    !options.ignoreWhitespace &&
    !options.ignoreCase &&
    !options.ignoreComments &&
    !options.ignoreQuotes &&
    !options.ignoreTimestampPrecision &&
    !options.ignoreLengthSemantics
  )
    return out;
  const normalize = (code: string, identifier = false) => {
    let value = code;
    if (!identifier && options.ignoreTimestampPrecision)
      value = value.replace(/\b(timestamp|datetime2|datetimeoffset|time)\s*\(\s*\d+\s*\)/gi, "$1");
    if (!identifier && options.ignoreLengthSemantics)
      value = value.replace(/\(\s*(\d+)\s+(?:byte|char)\s*\)/gi, "($1)");
    if (options.ignoreWhitespace && !identifier) value = value.replace(/\s+/g, " ");
    if (options.ignoreCase) value = value.toLowerCase();
    return value;
  };
  let result = "";
  let pending = "";
  let code = 0;
  for (const match of out.matchAll(CANONICAL_TOKEN[kind] ?? TOKEN)) {
    const token = match[0];
    const start = match.index ?? 0;
    pending += out.slice(code, start);
    code = start + token.length;
    if (/^(?:--|\/\*|#)/.test(token)) {
      if (options.ignoreComments) pending += " ";
      else {
        result += normalize(pending) + normalize(token);
        pending = "";
      }
      continue;
    }
    if (/^[`["]/.test(token) && !(kind === "mysql" && token.startsWith('"'))) {
      const name = token.slice(1, -1).replace(/""|``|]]/g, (pair) => pair[0]);
      if (options.ignoreQuotes && plainIdentifier(name, kind) && !KEYWORDS.has(name.toLowerCase()))
        pending += name;
      else {
        result += normalize(pending) + normalize(token, true);
        pending = "";
      }
      continue;
    }
    result += normalize(pending) + token;
    pending = "";
  }
  result += normalize(pending + out.slice(code));
  return options.ignoreComments ? result.trim() : result;
}

const NULL_DEFAULT = /^\(*\s*null\s*(?:::\s*[\w\s."[\]]+)?\)*$/i;

export function attributeValue(object: CatalogObject, key: string, context: CompareContext) {
  const value = object.attributes[key];
  if (value === undefined) return "";
  const { options } = context;
  if (key === "current" && options.ignoreSequenceValues) return "";
  if (key === "tablespace" && options.ignoreTablespace) return "";
  if (key === "default" && options.ignoreDefaultNull && NULL_DEFAULT.test(value)) return "";
  return canonical(value, context.targetSchema, context.kind, options);
}

function comparableAttributes(object: CatalogObject, context: CompareContext) {
  const values: Record<string, string> = {};
  for (const key of Object.keys(object.attributes))
    values[key] = attributeValue(object, key, context);
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
  if (
    !context.options.ignoreTablespace &&
    (source.attributes.tablespace ?? "") !== (target.attributes.tablespace ?? "")
  )
    out.push(ATTRIBUTE_LABELS.tablespace);
  return out;
}

export function objectKey(object: CatalogObject, context: CompareContext): string {
  const base = `${object.object_type}|${object.parent ?? ""}|`;
  if (
    object.attributes.definition &&
    ((context.options.ignoreSystemNames && object.attributes.generated === "YES") ||
      (context.options.ignoreConstraintNames && object.object_type === "constraint"))
  )
    return `${base}#${canonical(object.attributes.definition, context.targetSchema, context.kind, context.options)}`;
  return `${base}${object.name}`;
}

export function excludePattern(patterns: string): RegExp | null {
  const parts = patterns
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part.replace(/\\([\s\S])|(%)|(_)|([\s\S])/g, (_, escaped, any, one, plain) =>
        any ? "[\\s\\S]*" : one ? "[\\s\\S]" : escapeRegExp(escaped ?? plain),
      ),
    );
  return parts.length > 0 ? new RegExp(`^(?:${parts.join("|")})$`, "i") : null;
}

export function limitDifferences(
  items: DiffItem[],
  limit: number,
): { items: DiffItem[]; omitted: number } {
  if (!limit || limit <= 0) return { items, omitted: 0 };
  let shown = 0;
  let omitted = 0;
  const kept = items.filter((item) => {
    if (item.status === "identical") return true;
    if (shown < limit) {
      shown++;
      return true;
    }
    omitted++;
    return false;
  });
  return { items: kept, omitted };
}

function typeRank(type: CatalogObjectType): number {
  return TYPE_ORDER.indexOf(type);
}

export function compareCatalogs(
  source: CatalogObject[],
  target: CatalogObject[],
  context: CompareContext,
): DiffItem[] {
  const pattern = excludePattern(context.options.excludePatterns ?? "");
  const kept = (object: CatalogObject) => !pattern?.test(object.parent ?? object.name);
  const src = source
    .filter(kept)
    .map((object) =>
      requalifyObject(object, context.sourceSchema, context.targetSchema, context.kind),
    );
  const tgt = target.filter(kept);
  const containers = (list: CatalogObject[]) =>
    new Set(list.filter((item) => CONTAINER_TYPES.has(item.object_type)).map((item) => item.name));
  const sourceContainers = containers(src);
  const targetContainers = containers(tgt);
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
  const right = index(tgt, "t", onlyTarget);
  const columns = (list: CatalogObject[]) => {
    const map = new Map<string, string[]>();
    if (context.options.ignoreColumnOrder) return map;
    for (const object of list)
      if (object.object_type === "column" && object.parent)
        map.set(object.parent, [...(map.get(object.parent) ?? []), object.name]);
    return map;
  };
  const sourceColumns = columns(src);
  const targetColumns = columns(tgt);
  const reordered = (table: string) => {
    const a = sourceColumns.get(table) ?? [];
    const b = targetColumns.get(table) ?? [];
    const common = (list: string[], other: string[]) => list.filter((name) => other.includes(name));
    return common(a, b).join("\u0000") !== common(b, a).join("\u0000");
  };
  const items: DiffItem[] = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key) ?? null;
    const b = right.get(key) ?? null;
    const base = (a ?? b) as CatalogObject;
    let status: DiffStatus = a ? "only_source" : "only_target";
    let differsBy: string[] = [];
    if (a && b) {
      differsBy = differences(a, b, context);
      if (
        base.object_type === "table" &&
        !context.options.ignoreColumnOrder &&
        reordered(base.name)
      )
        differsBy.push(COLUMN_ORDER);
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
    if ((item.status === "only_source" || item.status === "different") && !item.blocked)
      selection[item.key] = true;
  return selection;
}

export function renameCandidates(items: DiffItem[], item: DiffItem): DiffItem[] {
  if (item.type !== "column" || (item.status !== "only_source" && item.status !== "only_target"))
    return [];
  const wanted = item.status === "only_source" ? "only_target" : "only_source";
  const type = (entry: DiffItem) => (entry.source ?? entry.target)?.attributes.type ?? "";
  return items.filter(
    (other) =>
      other.type === "column" &&
      other.status === wanted &&
      other.parent === item.parent &&
      type(other) === type(item),
  );
}

export function markMissingTablespaces(items: DiffItem[], available: ReadonlySet<string>): void {
  for (const item of items) {
    if (!item.source) continue;
    const creates =
      (item.status === "only_source" && (item.type === "table" || item.type === "index")) ||
      (item.status === "different" && item.type === "index");
    if (!creates) continue;
    const missing = [item.source, ...item.children]
      .map((object) => object.attributes.tablespace)
      .filter((name): name is string => Boolean(name) && !available.has(name as string));
    if (missing.length > 0)
      item.blocked = `Tablespace ${[...new Set(missing)].join(", ")} fehlt im Ziel oder ist dort nicht nutzbar`;
  }
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

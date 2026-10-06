export type JsonPath = (string | number)[];

export type JsonKind = "object" | "array" | "string" | "number" | "boolean" | "null";

export type JsonRow = {
  path: JsonPath;
  id: string;
  key: string | number | null;
  value: unknown;
  kind: JsonKind;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  childCount: number;
  closing?: boolean;
};

export type JsonStats = { nodes: number; depth: number; bytes: number };

export function jsonKind(value: unknown): JsonKind {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number" || typeof value === "bigint") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

export function pathId(path: JsonPath): string {
  return JSON.stringify(path);
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

function entries(value: unknown): [string | number, unknown][] {
  if (Array.isArray(value)) return value.map((item, index) => [index, item]);
  if (isContainer(value)) return Object.entries(value);
  return [];
}

export function childCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (isContainer(value)) return Object.keys(value).length;
  return 0;
}

export function getAt(root: unknown, path: JsonPath): unknown {
  let current = root;
  for (const segment of path) {
    if (!isContainer(current)) return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

export function updateAt(
  root: unknown,
  path: JsonPath,
  update: (value: unknown) => unknown,
): unknown {
  if (path.length === 0) return update(root);
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const next = root.slice();
    next[head as number] = updateAt(root[head as number], rest, update);
    return next;
  }
  if (isContainer(root)) {
    return { ...root, [head]: updateAt((root as Record<string, unknown>)[head], rest, update) };
  }
  return root;
}

export function setAt(root: unknown, path: JsonPath, value: unknown): unknown {
  return updateAt(root, path, () => value);
}

export function removeAt(root: unknown, path: JsonPath): unknown {
  if (path.length === 0) return null;
  const key = path[path.length - 1];
  return updateAt(root, path.slice(0, -1), (parent) => {
    if (Array.isArray(parent)) return parent.filter((_, index) => index !== key);
    if (!isContainer(parent)) return parent;
    const next = { ...parent } as Record<string, unknown>;
    delete next[key as string];
    return next;
  });
}

export function renameKey(root: unknown, path: JsonPath, nextKey: string): unknown {
  const key = path[path.length - 1];
  return updateAt(root, path.slice(0, -1), (parent) => {
    if (!isContainer(parent) || Array.isArray(parent)) return parent;
    const next: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(parent)) next[name === key ? nextKey : name] = value;
    return next;
  });
}

export function uniqueKey(parent: unknown, base = "neu"): string {
  const taken = isContainer(parent) ? new Set(Object.keys(parent)) : new Set<string>();
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}${index}`)) index++;
  return `${base}${index}`;
}

export function insertChild(
  root: unknown,
  path: JsonPath,
  value: unknown,
): { root: unknown; path: JsonPath } {
  const parent = getAt(root, path);
  if (Array.isArray(parent)) {
    return { root: setAt(root, path, [...parent, value]), path: [...path, parent.length] };
  }
  const key = uniqueKey(parent);
  return {
    root: setAt(root, path, { ...(parent as Record<string, unknown>), [key]: value }),
    path: [...path, key],
  };
}

export function insertAfter(
  root: unknown,
  path: JsonPath,
  value: unknown,
  copyKey = false,
): { root: unknown; path: JsonPath } {
  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1];
  const parent = getAt(root, parentPath);
  if (Array.isArray(parent)) {
    const index = (key as number) + 1;
    const next = [...parent.slice(0, index), value, ...parent.slice(index)];
    return { root: setAt(root, parentPath, next), path: [...parentPath, index] };
  }
  const newKey = uniqueKey(parent, copyKey ? `${key}_kopie` : "neu");
  const next: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(parent as Record<string, unknown>)) {
    next[name] = item;
    if (name === key) next[newKey] = value;
  }
  return { root: setAt(root, parentPath, next), path: [...parentPath, newKey] };
}

export function moveItem(
  root: unknown,
  path: JsonPath,
  delta: number,
): { root: unknown; path: JsonPath } | null {
  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1];
  const parent = getAt(root, parentPath);
  if (Array.isArray(parent)) {
    const target = (key as number) + delta;
    if (target < 0 || target >= parent.length) return null;
    const next = parent.slice();
    [next[key as number], next[target]] = [next[target], next[key as number]];
    return { root: setAt(root, parentPath, next), path: [...parentPath, target] };
  }
  if (!isContainer(parent)) return null;
  const list = Object.entries(parent);
  const index = list.findIndex(([name]) => name === key);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return null;
  [list[index], list[target]] = [list[target], list[index]];
  return { root: setAt(root, parentPath, Object.fromEntries(list)), path };
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!isContainer(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((key) => [key, sortKeysDeep((value as Record<string, unknown>)[key])]),
  );
}

export function convertValue(value: unknown, kind: JsonKind): unknown {
  const current = jsonKind(value);
  if (current === kind) return value;
  switch (kind) {
    case "null":
      return null;
    case "boolean":
      return current === "string" ? value === "true" : Boolean(value) && current !== "array";
    case "number": {
      const number = Number(current === "boolean" ? Number(value) : value);
      return Number.isFinite(number) ? number : 0;
    }
    case "string":
      return current === "object" || current === "array"
        ? JSON.stringify(value)
        : String(value ?? "");
    case "array":
      if (current === "object") return Object.values(value as object);
      if (current === "string") {
        const parsed = parseEmbeddedJson(value as string);
        if (Array.isArray(parsed)) return parsed;
      }
      return current === "null" ? [] : [value];
    case "object":
      if (current === "array")
        return Object.fromEntries((value as unknown[]).map((item, index) => [index, item]));
      if (current === "string") {
        const parsed = parseEmbeddedJson(value as string);
        if (jsonKind(parsed) === "object") return parsed;
      }
      return current === "null" ? {} : { wert: value };
  }
}

export function parseEmbeddedJson(text: string): unknown {
  const trimmed = text.trim();
  if (
    !(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
    !(trimmed.startsWith("[") && trimmed.endsWith("]"))
  )
    return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function parseSmartValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

export function parseTypedInput(
  text: string,
  kind: JsonKind,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (kind === "string") return { ok: true, value: text };
  if (kind === "number") {
    const number = Number(text.trim());
    return text.trim() !== "" && Number.isFinite(number)
      ? { ok: true, value: number }
      : { ok: false, error: "Keine gültige Zahl" };
  }
  const value = parseSmartValue(text);
  if ((kind === "object" || kind === "array") && typeof value === "string")
    return { ok: false, error: "Ungültiges JSON" };
  return { ok: true, value };
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function toJsonPath(path: JsonPath): string {
  return path.reduce<string>(
    (out, segment) =>
      typeof segment === "number"
        ? `${out}[${segment}]`
        : IDENTIFIER.test(segment)
          ? `${out}.${segment}`
          : `${out}[${JSON.stringify(segment)}]`,
    "$",
  );
}

export function toJsAccessor(path: JsonPath, base = "data"): string {
  return toJsonPath(path).replace(/^\$/, base);
}

function quoteSqlIdentifier(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

function sqlLiteral(segment: string | number): string {
  return typeof segment === "number" ? String(segment) : `'${segment.replace(/'/g, "''")}'`;
}

export function toPostgresAccessor(path: JsonPath, column: string, asText = true): string {
  const base = quoteSqlIdentifier(column);
  if (path.length === 0) return base;
  return path
    .map(
      (segment, index) =>
        `${index === path.length - 1 && asText ? "->>" : "->"}${sqlLiteral(segment)}`,
    )
    .reduce((out, part) => `${out}${part}`, base);
}

export function toPostgresPath(path: JsonPath): string {
  const parts = path.map((segment) =>
    typeof segment === "number" || /^[\w$-]+$/.test(segment)
      ? String(segment)
      : JSON.stringify(segment),
  );
  return `'{${parts.join(",")}}'`;
}

export function computeStats(value: unknown, text: string): JsonStats {
  let nodes = 0;
  let depth = 0;
  const stack: [unknown, number][] = [[value, 1]];
  while (stack.length) {
    const [current, level] = stack.pop() as [unknown, number];
    nodes++;
    if (level > depth) depth = level;
    for (const [, child] of entries(current)) stack.push([child, level + 1]);
  }
  return { nodes, depth, bytes: new TextEncoder().encode(text).length };
}

export function collectExpandable(
  value: unknown,
  maxDepth = Number.POSITIVE_INFINITY,
): Set<string> {
  const out = new Set<string>();
  const walk = (current: unknown, path: JsonPath) => {
    if (!isContainer(current) || path.length >= maxDepth) return;
    out.add(pathId(path));
    for (const [key, child] of entries(current)) walk(child, [...path, key]);
  };
  walk(value, []);
  return out;
}

export function findMatches(value: unknown, query: string): JsonPath[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const out: JsonPath[] = [];
  const walk = (current: unknown, path: JsonPath, key: string | number | null) => {
    const keyHit = typeof key === "string" && key.toLowerCase().includes(needle);
    const valueHit =
      !isContainer(current) &&
      String(current === null ? "null" : current)
        .toLowerCase()
        .includes(needle);
    if (keyHit || valueHit) out.push(path);
    for (const [childKey, child] of entries(current)) walk(child, [...path, childKey], childKey);
  };
  walk(value, [], null);
  return out;
}

export function ancestorIds(paths: JsonPath[]): Set<string> {
  const out = new Set<string>();
  for (const path of paths)
    for (let index = 0; index < path.length; index++) out.add(pathId(path.slice(0, index)));
  return out;
}

export function flattenRows(value: unknown, expanded: Set<string>): JsonRow[] {
  const rows: JsonRow[] = [];
  const walk = (current: unknown, path: JsonPath, key: string | number | null) => {
    const kind = jsonKind(current);
    const expandable = kind === "object" || kind === "array";
    const id = pathId(path);
    const isOpen = expandable && expanded.has(id);
    const count = childCount(current);
    rows.push({
      path,
      id,
      key,
      value: current,
      kind,
      depth: path.length,
      expandable,
      expanded: isOpen,
      childCount: count,
    });
    if (!isOpen) return;
    for (const [childKey, child] of entries(current)) walk(child, [...path, childKey], childKey);
    if (count > 0)
      rows.push({
        path,
        id: `${id}#end`,
        key: null,
        value: current,
        kind,
        depth: path.length,
        expandable: false,
        expanded: false,
        childCount: count,
        closing: true,
      });
  };
  walk(value, [], null);
  return rows;
}

export function tableShape(
  value: unknown,
): { columns: string[]; rows: Record<string, unknown>[] } | null {
  if (jsonKind(value) === "object")
    return { columns: Object.keys(value as object), rows: [value as Record<string, unknown>] };
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((item) => jsonKind(item) === "object")) return null;
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const item of value as Record<string, unknown>[])
    for (const key of Object.keys(item))
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
  return { columns, rows: value as Record<string, unknown>[] };
}

export function previewValue(value: unknown, limit = 60): string {
  const kind = jsonKind(value);
  if (kind === "array") {
    const parts = (value as unknown[]).slice(0, 5).map((item) => previewScalar(item));
    return `[${parts.join(", ")}${(value as unknown[]).length > 5 ? ", …" : ""}]`.slice(0, limit);
  }
  if (kind === "object") {
    const keys = Object.keys(value as object);
    return `{${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""}}`.slice(0, limit);
  }
  return previewScalar(value).slice(0, limit);
}

function previewScalar(value: unknown): string {
  const kind = jsonKind(value);
  if (kind === "object") return "{…}";
  if (kind === "array") return "[…]";
  if (kind === "string") return JSON.stringify(value);
  return String(value);
}

const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StringHint = "url" | "email" | "date" | "color" | "uuid" | "json" | null;

export function stringHint(text: string): StringHint {
  if (URL_PATTERN.test(text)) return "url";
  if (EMAIL.test(text)) return "email";
  if (HEX_COLOR.test(text)) return "color";
  if (UUID.test(text)) return "uuid";
  if (ISO_DATE.test(text) && !Number.isNaN(Date.parse(text))) return "date";
  if (parseEmbeddedJson(text) !== undefined) return "json";
  return null;
}

export function stringifyJson(value: unknown, indent: number | string = 2): string {
  return JSON.stringify(value, null, indent) ?? "null";
}

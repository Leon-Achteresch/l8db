import type { ColumnInfo, ForeignKeyInfo, TableInfo } from "@/lib/db/types";

export interface SchemaSource {
  tables: TableInfo[];
  views: TableInfo[];
  columns: ColumnInfo[];
}

export interface RankInput {
  sql: string;
  prompt?: string;
  recent?: string[];
  foreignKeys?: ForeignKeyInfo[];
  defaultSchema?: string | null;
}

interface SchemaObject {
  table: TableInfo;
  view: boolean;
  key: string;
  schemaKey: string;
  nameKey: string;
  order: number;
}

interface OverviewGroup {
  schema: string;
  schemaKey: string;
  names: string[];
}

interface SchemaIndex {
  views: TableInfo[];
  columns: ColumnInfo[];
  objects: SchemaObject[];
  byKey: Map<string, SchemaObject>;
  byName: Map<string, SchemaObject[]>;
  phrases: { byPhrase: Map<string, SchemaObject[]>; maxWords: number } | null;
  columnsByKey: Map<string, ColumnInfo[]> | null;
  groups: OverviewGroup[] | null;
  overviews: Map<string, string>;
}

type FkTargets = Map<string, Map<string, ForeignKeyInfo>>;

interface FkIndex {
  neighbours: Map<string, Set<string>>;
  targets: FkTargets;
}

const indexCache = new WeakMap<TableInfo[], SchemaIndex>();
const fkCache = new WeakMap<ForeignKeyInfo[], FkIndex>();
const stats = { indexBuilds: 0, fkBuilds: 0 };

export function schemaContextStats(): { indexBuilds: number; fkBuilds: number } {
  return { ...stats };
}

function keyOf(schema: string, name: string): string {
  return `${schema.toLowerCase()}\u0000${name.toLowerCase()}`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function singularWord(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(x|ch|sh|ss|us)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

export function phraseWords(text: string): string[] {
  const words: string[] = [];
  const spaced = text.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2");
  for (const part of spaced.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (part) words.push(singularWord(part));
  }
  return words;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function buildIndex(source: SchemaSource): SchemaIndex {
  stats.indexBuilds++;
  const byKey = new Map<string, SchemaObject>();
  const add = (table: TableInfo, view: boolean) => {
    const key = keyOf(table.schema, table.name);
    if (byKey.has(key)) return;
    byKey.set(key, {
      table,
      view,
      key,
      schemaKey: table.schema.toLowerCase(),
      nameKey: table.name.toLowerCase(),
      order: 0,
    });
  };
  for (const table of source.tables) add(table, false);
  for (const view of source.views) add(view, true);
  const objects = [...byKey.values()].sort(
    (a, b) =>
      compareText(a.schemaKey, b.schemaKey) ||
      compareText(a.nameKey, b.nameKey) ||
      compareText(a.table.schema, b.table.schema) ||
      compareText(a.table.name, b.table.name),
  );
  const byName = new Map<string, SchemaObject[]>();
  for (const [order, object] of objects.entries()) {
    object.order = order;
    pushTo(byName, object.nameKey, object);
  }
  return {
    views: source.views,
    columns: source.columns,
    objects,
    byKey,
    byName,
    phrases: null,
    columnsByKey: null,
    groups: null,
    overviews: new Map(),
  };
}

function schemaIndex(source: SchemaSource): SchemaIndex {
  const cached = indexCache.get(source.tables);
  if (cached && cached.views === source.views && cached.columns === source.columns) return cached;
  const index = buildIndex(source);
  indexCache.set(source.tables, index);
  return index;
}

function columnsByKey(index: SchemaIndex): Map<string, ColumnInfo[]> {
  if (index.columnsByKey) return index.columnsByKey;
  const map = new Map<string, ColumnInfo[]>();
  for (const column of index.columns) pushTo(map, keyOf(column.schema, column.table), column);
  index.columnsByKey = map;
  return map;
}

function fkIndex(foreignKeys: ForeignKeyInfo[]): FkIndex {
  const cached = fkCache.get(foreignKeys);
  if (cached) return cached;
  stats.fkBuilds++;
  const neighbours = new Map<string, Set<string>>();
  const targets: FkTargets = new Map();
  const link = (from: string, to: string) => {
    const set = neighbours.get(from);
    if (set) set.add(to);
    else neighbours.set(from, new Set([to]));
  };
  for (const fk of foreignKeys) {
    const from = keyOf(fk.from_schema, fk.from_table);
    const to = keyOf(fk.to_schema, fk.to_table);
    link(from, to);
    link(to, from);
    let columns = targets.get(from);
    if (!columns) {
      columns = new Map();
      targets.set(from, columns);
    }
    const column = fk.from_column.toLowerCase();
    if (!columns.has(column)) columns.set(column, fk);
  }
  const index = { neighbours, targets };
  fkCache.set(foreignKeys, index);
  return index;
}

function isIdentStart(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code >= 128;
}

function isIdentPart(code: number): boolean {
  return isIdentStart(code) || (code >= 48 && code <= 57) || code === 36 || code === 35;
}

function isSpaceCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11;
}

export function sqlIdentifierChains(sql: string): string[][] {
  const chains: string[][] = [];
  const length = sql.length;
  let current: string[] | null = null;
  let afterDot = false;
  let index = 0;
  const pushPart = (part: string) => {
    if (current && afterDot) current.push(part);
    else {
      current = [part];
      chains.push(current);
    }
    afterDot = false;
  };
  const reset = () => {
    current = null;
    afterDot = false;
  };
  while (index < length) {
    const code = sql.charCodeAt(index);
    const next = sql.charCodeAt(index + 1);
    if (code === 45 && next === 45) {
      const end = sql.indexOf("\n", index);
      index = end < 0 ? length : end + 1;
      reset();
      continue;
    }
    if (code === 47 && next === 42) {
      const end = sql.indexOf("*/", index + 2);
      index = end < 0 ? length : end + 2;
      reset();
      continue;
    }
    if (code === 39) {
      index++;
      while (index < length) {
        if (sql.charCodeAt(index) === 39) {
          if (sql.charCodeAt(index + 1) === 39) index += 2;
          else break;
        } else index++;
      }
      index++;
      reset();
      continue;
    }
    if (code === 34 || code === 96 || code === 91) {
      const close = code === 91 ? 93 : code;
      let part = "";
      let cursor = index + 1;
      while (cursor < length) {
        const ch = sql.charCodeAt(cursor);
        if (ch === close) {
          if (close !== 93 && sql.charCodeAt(cursor + 1) === close) {
            part += sql[cursor];
            cursor += 2;
            continue;
          }
          if (close === 93 && sql.charCodeAt(cursor + 1) === 93) {
            part += "]";
            cursor += 2;
            continue;
          }
          break;
        }
        part += sql[cursor];
        cursor++;
      }
      index = cursor + 1;
      pushPart(part.toLowerCase());
      continue;
    }
    if (isIdentStart(code)) {
      let cursor = index + 1;
      while (cursor < length && isIdentPart(sql.charCodeAt(cursor))) cursor++;
      pushPart(sql.slice(index, cursor).toLowerCase());
      index = cursor;
      continue;
    }
    if (code >= 48 && code <= 57) {
      let cursor = index + 1;
      while (cursor < length) {
        const ch = sql.charCodeAt(cursor);
        if (isIdentPart(ch) || ch === 46) cursor++;
        else break;
      }
      index = cursor;
      reset();
      continue;
    }
    if (code === 46 && current) {
      afterDot = true;
      index++;
      continue;
    }
    if (isSpaceCode(code)) {
      if (!afterDot) current = null;
      index++;
      continue;
    }
    reset();
    index++;
  }
  return chains;
}

function referencedObjects(sql: string, index: SchemaIndex): Set<SchemaObject> {
  const found = new Set<SchemaObject>();
  for (const parts of sqlIdentifierChains(sql)) {
    let qualified = false;
    for (let end = parts.length - 1; end >= 1; end--) {
      const object = index.byKey.get(`${parts[end - 1]}\u0000${parts[end]}`);
      if (object) {
        found.add(object);
        qualified = true;
        break;
      }
    }
    if (qualified) continue;
    const bareCount = parts.length === 1 ? 1 : parts.length - 1;
    for (let position = 0; position < bareCount; position++) {
      const matches = index.byName.get(parts[position]);
      if (matches) for (const object of matches) found.add(object);
    }
  }
  return found;
}

function sortObjects(objects: Iterable<SchemaObject>): SchemaObject[] {
  return [...objects].sort((a, b) => a.order - b.order);
}

export function referencedTables(sql: string, source: SchemaSource): TableInfo[] {
  const index = schemaIndex(source);
  return sortObjects(referencedObjects(sql, index)).map((object) => object.table);
}

function phraseIndex(index: SchemaIndex) {
  if (index.phrases) return index.phrases;
  const byPhrase = new Map<string, SchemaObject[]>();
  let maxWords = 1;
  for (const object of index.objects) {
    const words = phraseWords(object.table.name);
    if (words.length === 0) continue;
    maxWords = Math.max(maxWords, Math.min(words.length, 8));
    pushTo(byPhrase, words.join(" "), object);
  }
  index.phrases = { byPhrase, maxWords };
  return index.phrases;
}

function promptObjects(prompt: string, index: SchemaIndex): Set<SchemaObject> {
  const found = new Set<SchemaObject>();
  const { byPhrase, maxWords } = phraseIndex(index);
  const words = phraseWords(prompt);
  let start = 0;
  while (start < words.length) {
    let phrase = "";
    let best: SchemaObject[] | undefined;
    let bestSize = 1;
    for (let size = 1; size <= maxWords && start + size <= words.length; size++) {
      phrase = size === 1 ? words[start] : `${phrase} ${words[start + size - 1]}`;
      const matches = byPhrase.get(phrase);
      if (matches) {
        best = matches;
        bestSize = size;
      }
    }
    if (best) for (const object of best) found.add(object);
    start += best ? bestSize : 1;
  }
  return found;
}

function resolveRecent(entry: string, index: SchemaIndex): SchemaObject | undefined {
  const lower = entry.toLowerCase();
  let dot = lower.indexOf(".");
  while (dot >= 0) {
    const object = index.byKey.get(`${lower.slice(0, dot)}\u0000${lower.slice(dot + 1)}`);
    if (object) return object;
    dot = lower.indexOf(".", dot + 1);
  }
  const bare = index.byName.get(lower);
  return bare?.length === 1 ? bare[0] : undefined;
}

export function rankTables(source: SchemaSource, input: RankInput, limit = 12): TableInfo[] {
  const index = schemaIndex(source);
  const scores = new Map<SchemaObject, number>();
  const add = (object: SchemaObject, score: number) =>
    scores.set(object, (scores.get(object) ?? 0) + score);
  const referenced = referencedObjects(input.sql, index);
  for (const object of referenced) add(object, 100);
  if (input.prompt) for (const object of promptObjects(input.prompt, index)) add(object, 40);
  if (input.foreignKeys?.length && referenced.size > 0) {
    const { neighbours } = fkIndex(input.foreignKeys);
    const hops = new Set<SchemaObject>();
    for (const object of referenced) {
      const keys = neighbours.get(object.key);
      if (!keys) continue;
      for (const key of keys) {
        const neighbour = index.byKey.get(key);
        if (neighbour && neighbour !== object) hops.add(neighbour);
      }
    }
    for (const object of hops) add(object, 25);
  }
  if (input.recent?.length) {
    const recent = new Set<SchemaObject>();
    for (const entry of input.recent) {
      const object = resolveRecent(entry, index);
      if (object) recent.add(object);
    }
    for (const object of recent) add(object, 10);
  }
  const defaultSchema = input.defaultSchema?.toLowerCase();
  const ranked = [...scores.entries()]
    .map(([object, score]) => ({
      object,
      score: score + (defaultSchema !== undefined && object.schemaKey === defaultSchema ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.object.order - b.object.order);
  return ranked.slice(0, Math.max(0, limit)).map((entry) => entry.object.table);
}

function overviewGroups(index: SchemaIndex): OverviewGroup[] {
  if (index.groups) return index.groups;
  const groups: OverviewGroup[] = [];
  let group: OverviewGroup | null = null;
  for (const object of index.objects) {
    if (!group || group.schemaKey !== object.schemaKey) {
      group = { schema: object.table.schema, schemaKey: object.schemaKey, names: [] };
      groups.push(group);
    }
    group.names.push(object.view ? `v:${object.table.name}` : object.table.name);
  }
  index.groups = groups;
  return groups;
}

function orderedGroups(index: SchemaIndex, defaultSchema: string | null | undefined) {
  const groups = overviewGroups(index);
  const first = defaultSchema?.toLowerCase();
  if (first === undefined) return groups;
  const position = groups.findIndex((group) => group.schemaKey === first);
  if (position <= 0) return groups;
  return [groups[position], ...groups.slice(0, position), ...groups.slice(position + 1)];
}

function groupPrefix(group: OverviewGroup): string {
  return group.schema ? `${group.schema}: ` : "";
}

export function schemaOverview(
  source: SchemaSource,
  options: { maxChars?: number; defaultSchema?: string | null } = {},
): string {
  const index = schemaIndex(source);
  const maxChars = Math.max(0, options.maxChars ?? 6000);
  const cacheKey = `${maxChars}\u0000${options.defaultSchema ?? ""}\u0000${options.defaultSchema == null ? 0 : 1}`;
  const cached = index.overviews.get(cacheKey);
  if (cached !== undefined) return cached;
  const groups = orderedGroups(index, options.defaultSchema);
  const full = groups.map((group) => groupPrefix(group) + group.names.join(", ")).join("\n");
  let result = full;
  if (full.length > maxChars) {
    const total = index.objects.length;
    const budget = maxChars - `\n… +${total} weitere Objekte`.length;
    const lines: string[] = [];
    let used = 0;
    let included = 0;
    for (const group of groups) {
      const prefix = groupPrefix(group);
      let line = "";
      for (const name of group.names) {
        const piece = line ? `, ${name}` : prefix + name;
        const extra = piece.length + (line || lines.length === 0 ? 0 : 1);
        if (used + extra > budget) break;
        line += piece;
        used += extra;
        included++;
      }
      if (line) lines.push(line);
      if (used >= budget) break;
    }
    const suffix = `… +${total - included} weitere Objekte`;
    result = lines.length ? `${lines.join("\n")}\n${suffix}` : suffix.slice(0, maxChars);
  }
  if (index.overviews.size >= 16) index.overviews.clear();
  index.overviews.set(cacheKey, result);
  return result;
}

const TYPE_ALIASES: [RegExp, string][] = [
  [/^character varying\b/, "varchar"],
  [/^character\b/, "char"],
  [/^timestamp(\(\d+\))? without time zone$/, "timestamp$1"],
  [/^timestamp(\(\d+\))? with time zone$/, "timestamptz$1"],
  [/^time(\(\d+\))? without time zone$/, "time$1"],
  [/^time(\(\d+\))? with time zone$/, "timetz$1"],
  [/^double precision$/, "float8"],
  [/^integer$/, "int4"],
  [/^smallint$/, "int2"],
  [/^bigint$/, "int8"],
  [/^real$/, "float4"],
  [/^boolean$/, "bool"],
];

export function shortType(dataType: string): string {
  let type = dataType.trim().replace(/\s+/g, " ");
  let arraySuffix = "";
  const array = /(\[\])+$/.exec(type);
  if (array) {
    arraySuffix = array[0];
    type = type.slice(0, -arraySuffix.length).trimEnd();
  }
  const lower = type.toLowerCase();
  for (const [pattern, replacement] of TYPE_ALIASES) {
    if (pattern.test(lower)) {
      type = lower.replace(pattern, replacement);
      break;
    }
  }
  const open = type.indexOf("(");
  if (open > 0 && type.endsWith(")")) {
    const args = splitArgs(type.slice(open + 1, -1));
    if (args.length > 3) type = `${type.slice(0, open)}(${args.slice(0, 3).join(",")},…)`;
  }
  return type + arraySuffix;
}

function splitArgs(text: string): string[] {
  const args: string[] = [];
  let quote = false;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    if (ch === "'") quote = !quote;
    else if (ch === "," && !quote) {
      args.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(text.slice(start).trim());
  return args;
}

function ident(name: string): string {
  return /^[\p{L}_][\p{L}\p{N}_$]*$/u.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

function tableLabel(schema: string, name: string, defaultSchema: string | null | undefined) {
  return schema && schema.toLowerCase() !== defaultSchema?.toLowerCase()
    ? `${ident(schema)}.${ident(name)}`
    : ident(name);
}

function formatTable(
  table: TableInfo,
  columns: ColumnInfo[],
  targets: Map<string, ForeignKeyInfo> | undefined,
  defaultSchema: string | null | undefined,
  maxChars = Number.POSITIVE_INFINITY,
): string {
  const head = tableLabel(table.schema, table.name, defaultSchema);
  if (columns.length === 0) return head;
  const parts = columns.map((column) => {
    const fk = targets?.get(column.name.toLowerCase());
    const reference = fk
      ? `→${fk.to_schema.toLowerCase() === table.schema.toLowerCase() ? ident(fk.to_table) : tableLabel(fk.to_schema, fk.to_table, defaultSchema)}.${ident(fk.to_column)}`
      : "";
    return `${ident(column.name)} ${shortType(column.data_type)}${reference}`;
  });
  const full = `${head}(${parts.join(", ")})`;
  if (full.length <= maxChars) return full;
  let line = `${head}(`;
  let shown = 0;
  for (const part of parts) {
    const piece = shown ? `, ${part}` : part;
    const tail = `, …+${parts.length - shown - 1})`;
    if (line.length + piece.length + tail.length > maxChars) break;
    line += piece;
    shown++;
  }
  return `${line}${shown ? ", " : ""}…+${parts.length - shown})`;
}

export function compactTable(
  table: TableInfo,
  columns: ColumnInfo[],
  foreignKeys?: ForeignKeyInfo[],
  options: { defaultSchema?: string | null; maxChars?: number } = {},
): string {
  const schema = table.schema.toLowerCase();
  const name = table.name.toLowerCase();
  const own = columns.filter(
    (column) => column.schema.toLowerCase() === schema && column.table.toLowerCase() === name,
  );
  const targets = foreignKeys?.length
    ? fkIndex(foreignKeys).targets.get(keyOf(table.schema, table.name))
    : undefined;
  return formatTable(table, own, targets, options.defaultSchema, options.maxChars);
}

export function relevantSchema(
  source: SchemaSource,
  tables: TableInfo[],
  options: {
    foreignKeys?: ForeignKeyInfo[];
    maxChars?: number;
    defaultSchema?: string | null;
  } = {},
): string {
  const index = schemaIndex(source);
  const maxChars = Math.max(0, options.maxChars ?? 4000);
  const columns = columnsByKey(index);
  const fk = options.foreignKeys?.length ? fkIndex(options.foreignKeys) : null;
  const seen = new Set<string>();
  const lines: string[] = [];
  const labels: { label: string; position: number }[] = [];
  let rest: { label: string; position: number }[] = [];
  let used = 0;
  for (const table of tables) {
    const key = keyOf(table.schema, table.name);
    if (seen.has(key)) continue;
    seen.add(key);
    let line = formatTable(
      table,
      columns.get(key) ?? [],
      fk?.targets.get(key),
      options.defaultSchema,
    );
    if (lines.length === 0 && line.length > maxChars) {
      line = formatTable(
        table,
        columns.get(key) ?? [],
        fk?.targets.get(key),
        options.defaultSchema,
        Math.floor(maxChars * 0.75),
      );
    }
    const label = tableLabel(table.schema, table.name, options.defaultSchema);
    const extra = line.length + (lines.length ? 1 : 0);
    if (used + extra <= maxChars) {
      lines.push(line);
      labels.push({ label, position: seen.size });
      used += extra;
    } else {
      rest.push({ label, position: seen.size });
    }
  }
  if (rest.length === 0) return lines.join("\n");
  const tailFor = (entries: { label: string }[]) =>
    `+ weitere: ${entries.map((entry) => entry.label).join(", ")}`;
  while (lines.length > 0 && used + 1 + tailFor(rest).length > maxChars) {
    const removed = lines.pop() as string;
    used -= removed.length + (lines.length ? 1 : 0);
    rest.push(labels.pop() as { label: string; position: number });
  }
  rest = rest.sort((a, b) => a.position - b.position);
  let tail = tailFor(rest);
  const room = maxChars - (lines.length ? used + 1 : 0);
  if (tail.length > room) {
    let shown = rest.length;
    while (shown > 0 && `${tailFor(rest.slice(0, shown))}, …`.length > room) shown--;
    tail = shown > 0 ? `${tailFor(rest.slice(0, shown))}, …` : "";
  }
  return lines.length ? (tail ? `${lines.join("\n")}\n${tail}` : lines.join("\n")) : tail;
}

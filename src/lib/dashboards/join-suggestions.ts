export interface SuggestTable {
  schema: string;
  table: string;
  columns: string[];
}

export interface JoinSuggestion {
  schema: string;
  table: string;
  fromColumn: string;
  toColumn: string;
  score: number;
  reason: "name" | "shared";
}

const GENERIC = new Set([
  "id",
  "name",
  "bezeichnung",
  "beschreibung",
  "description",
  "created",
  "created_at",
  "updated",
  "updated_at",
  "modified",
  "status",
  "type",
  "typ",
  "version",
  "datum",
  "date",
  "menge",
  "quantity",
  "value",
  "wert",
]);

const KEY_SUFFIX = /(?:_?(?:id|nr|no|num|key|code|uuid))$/i;

function stem(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(?:tbl|t|dim|fact|fct|v|vw)_/, "")
    .replace(/(?:en|es|e|s|n)$/, "");
}

function keyStem(column: string): string | null {
  const lower = column.toLowerCase();
  const match = /^(.+?)_?(?:id|nr|no|num|key|code|uuid)$/.exec(lower) ?? /^id_(.+)$/.exec(lower);
  const out = match ? stem(match[1]) : "";
  return out.length >= 3 ? out : null;
}

function primaryKey(columns: string[], table: string): string | null {
  const lower = columns.map((c) => c.toLowerCase());
  const own = stem(table);
  const exact = columns[lower.indexOf("id")];
  if (exact) return exact;
  return columns.find((c) => keyStem(c) === own) ?? null;
}

export function suggestJoins(
  base: SuggestTable,
  candidates: SuggestTable[],
  limit = 12,
): JoinSuggestion[] {
  const out: JoinSuggestion[] = [];
  const push = (s: JoinSuggestion) => {
    const twin = out.find(
      (o) =>
        o.schema === s.schema &&
        o.table === s.table &&
        o.fromColumn === s.fromColumn &&
        o.toColumn === s.toColumn,
    );
    if (twin) twin.score = Math.max(twin.score, s.score);
    else out.push(s);
  };
  for (const other of candidates) {
    if (other.schema === base.schema && other.table === base.table) continue;
    const otherStem = stem(other.table);
    const baseStem = stem(base.table);
    const otherKey = primaryKey(other.columns, other.table);
    const baseKey = primaryKey(base.columns, base.table);
    for (const column of base.columns) {
      const ks = keyStem(column);
      if (ks && otherKey && (ks === otherStem || otherStem.endsWith(ks) || ks.endsWith(otherStem)))
        push({ ...pick(other), fromColumn: column, toColumn: otherKey, score: 90, reason: "name" });
      const same = other.columns.find((c) => c.toLowerCase() === column.toLowerCase());
      if (same && !GENERIC.has(column.toLowerCase()))
        push({
          ...pick(other),
          fromColumn: column,
          toColumn: same,
          score: KEY_SUFFIX.test(column) ? (ks === otherStem ? 85 : 70) : 40,
          reason: "shared",
        });
    }
    if (baseKey)
      for (const column of other.columns) {
        const ks = keyStem(column);
        if (ks && (ks === baseStem || baseStem.endsWith(ks) || ks.endsWith(baseStem)))
          push({
            ...pick(other),
            fromColumn: baseKey,
            toColumn: column,
            score: 80,
            reason: "name",
          });
      }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

function pick(table: SuggestTable): { schema: string; table: string } {
  return { schema: table.schema, table: table.table };
}

export function likelyRelated(
  columns: string[],
  tables: { schema: string; table: string }[],
): Set<string> {
  const stems = new Set(columns.map(keyStem).filter((s): s is string => Boolean(s)));
  const out = new Set<string>();
  for (const t of tables) {
    const own = stem(t.table);
    if ([...stems].some((s) => s === own || own.endsWith(s) || s.endsWith(own)))
      out.add(`${t.schema}.${t.table}`);
  }
  return out;
}

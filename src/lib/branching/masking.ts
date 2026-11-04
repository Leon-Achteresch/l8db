import type { ColumnCategory, MaskColumn, MaskRule, MaskStrategy } from "@/lib/db";

export const STRATEGY_LABELS: Record<MaskStrategy, string> = {
  keep: "Unverändert",
  redact: "Schwärzen",
  null: "Leeren (NULL)",
  hash: "Pseudonym (Hash)",
  email: "Beispiel-E-Mail",
  name: "Beispielname",
  phone: "Beispiel-Telefonnummer",
  partial: "Teilweise verdecken",
  ip: "Dokumentations-IP",
  zero: "Null",
  year_only: "Nur Jahr",
  uuid: "Neue UUID",
  empty_json: "Leeres JSON",
  fixed: "Fester Wert",
};

const ORDER: MaskStrategy[] = [
  "keep",
  "redact",
  "null",
  "hash",
  "email",
  "name",
  "phone",
  "partial",
  "ip",
  "zero",
  "year_only",
  "uuid",
  "empty_json",
  "fixed",
];

export function compatible(
  strategy: MaskStrategy,
  category: ColumnCategory,
  notNull: boolean,
): boolean {
  switch (strategy) {
    case "keep":
    case "fixed":
      return true;
    case "null":
      return !notNull;
    case "ip":
      return category === "text" || category === "inet";
    case "zero":
      return category === "number";
    case "year_only":
      return category === "date" || category === "timestamp";
    case "uuid":
      return category === "uuid";
    case "empty_json":
      return category === "json";
    default:
      return category === "text";
  }
}

const UNIQUE_SAFE: MaskStrategy[] = ["keep", "null", "hash", "email", "uuid"];

export function strategiesFor(
  column: Pick<MaskColumn, "category" | "notNull" | "unique">,
): MaskStrategy[] {
  return ORDER.filter(
    (strategy) =>
      compatible(strategy, column.category, column.notNull) &&
      (!column.unique || UNIQUE_SAFE.includes(strategy)),
  );
}

export function columnKey(column: Pick<MaskRule, "schema" | "table" | "column">): string {
  return `${column.schema}.${column.table}.${column.column}`;
}

export function ownColumns(columns: MaskColumn[]): MaskColumn[] {
  return columns.filter(
    (column) =>
      !column.generated && column.schema === column.rootSchema && column.table === column.rootTable,
  );
}

export function uncovered(columns: MaskColumn[], rules: MaskRule[]): MaskColumn[] {
  const covered = new Set(rules.map(columnKey));
  return ownColumns(columns).filter((column) => column.pii && !covered.has(columnKey(column)));
}

export function invalidRules(columns: MaskColumn[], rules: MaskRule[]): string[] {
  const known = new Map(columns.map((column) => [columnKey(column), column]));
  const invalid = rules.flatMap((rule) => {
    const column = known.get(columnKey(rule));
    if (!column) return [`${columnKey(rule)}: Spalte existiert nicht`];
    if (column.generated) return [`${columnKey(rule)}: berechnete Spalte`];
    if (!compatible(rule.strategy, column.category, column.notNull))
      return [
        `${columnKey(rule)}: „${STRATEGY_LABELS[rule.strategy]}“ passt nicht zu ${column.dataType}`,
      ];
    if (rule.strategy === "fixed" && !rule.value) return [`${columnKey(rule)}: fester Wert fehlt`];
    if (column.unique && !UNIQUE_SAFE.includes(rule.strategy))
      return [
        `${columnKey(rule)}: eindeutige Spalte, „${STRATEGY_LABELS[rule.strategy]}“ erzeugt Duplikate`,
      ];
    return [];
  });
  const strategy = (key: string) => {
    const rule = rules.find((item) => columnKey(item) === key);
    return rule ? `${rule.strategy}\0${rule.value ?? ""}` : "keep\0";
  };
  const foreign = columns.flatMap((column) => {
    const key = columnKey(column);
    const own = strategy(key);
    if (own.startsWith("null\0")) return [];
    return (column.references ?? [])
      .filter((parent) => strategy(parent) !== own)
      .map((parent) => `${key}: braucht dieselbe Maskierung wie ${parent} (Fremdschlüssel)`);
  });
  return [...invalid, ...foreign];
}

export function suggestedRules(columns: MaskColumn[], rules: MaskRule[]): MaskRule[] {
  const additions = uncovered(columns, rules).flatMap((column) =>
    column.pii?.strategy
      ? [
          {
            schema: column.schema,
            table: column.table,
            column: column.column,
            strategy: column.pii.strategy,
          },
        ]
      : [],
  );
  return [...rules, ...additions];
}

export function setRule(
  rules: MaskRule[],
  column: Pick<MaskRule, "schema" | "table" | "column">,
  strategy: MaskStrategy | null,
  value?: string,
): MaskRule[] {
  const key = columnKey(column);
  const rest = rules.filter((rule) => columnKey(rule) !== key);
  if (!strategy) return rest;
  const next: MaskRule = {
    schema: column.schema,
    table: column.table,
    column: column.column,
    strategy,
  };
  if (strategy === "fixed") next.value = value ?? "";
  return [...rest, next].sort((a, b) => columnKey(a).localeCompare(columnKey(b)));
}

export function effectiveRules(team: MaskRule[], strict: boolean, local: MaskRule[]): MaskRule[] {
  if (strict) return team;
  const taken = new Set(team.map(columnKey));
  return [...team, ...local.filter((rule) => !taken.has(columnKey(rule)))];
}

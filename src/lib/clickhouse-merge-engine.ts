const mergeRules = {
  ReplacingMergeTree:
    "Beim Merge ersetzt ClickHouse mehrere Versionen mit demselben Sortierschlüssel durch eine Zeile.",
  CollapsingMergeTree:
    "Beim Merge hebt ClickHouse passende Zeilen mit entgegengesetztem Vorzeichen auf.",
  VersionedCollapsingMergeTree:
    "Beim Merge hebt ClickHouse passende Zeilen gleicher Version mit entgegengesetztem Vorzeichen auf.",
  SummingMergeTree:
    "Beim Merge summiert ClickHouse konfigurierte Werte von Zeilen mit demselben Sortierschlüssel.",
  AggregatingMergeTree:
    "Beim Merge kombiniert ClickHouse Aggregatzustände von Zeilen mit demselben Sortierschlüssel.",
} as const;

export type ClickhouseMergeContext = { engine: string; explanation: string };

export function clickhouseMergeContext(engine: unknown): ClickhouseMergeContext | undefined {
  if (typeof engine !== "string") return undefined;
  const base = engine.startsWith("Replicated") ? engine.slice("Replicated".length) : engine;
  if (!Object.hasOwn(mergeRules, base)) return undefined;
  return { engine, explanation: mergeRules[base as keyof typeof mergeRules] };
}

import type { FeatureEventValue } from "../events";

export type RuleCondition = FeatureEventValue | { min: number };

export interface PromoterRule {
  id: string;
  featureId: string;
  reason: string;
  event: string;
  where?: Readonly<Record<string, RuleCondition>>;
  count: number;
  windowMs: number;
  sameKey?: string;
  distinctKey?: string;
  after?: string;
  unless?: string;
  maxUses?: number;
}

const MINUTE = 60_000;

export const PROMOTER_RULES: readonly PromoterRule[] = [
  {
    id: "repeat-query",
    featureId: "query.snippets",
    reason: "Dieselbe Abfrage dreimal ausgeführt",
    event: "query.executed",
    where: { ok: true },
    sameKey: "hash",
    count: 3,
    windowMs: 30 * MINUTE,
  },
  {
    id: "repeat-slow-query",
    featureId: "index-advisor",
    reason: "Dieselbe Abfrage bleibt langsam",
    event: "query.executed",
    where: { ok: true, durationMs: { min: 2_000 } },
    sameKey: "hash",
    count: 2,
    windowMs: 60 * MINUTE,
  },
  {
    id: "slow-query",
    featureId: "explain",
    reason: "Abfrage lief über 5 Sekunden",
    event: "query.executed",
    where: { ok: true, durationMs: { min: 5_000 } },
    count: 1,
    windowMs: MINUTE,
  },
  {
    id: "joins",
    featureId: "er-diagram",
    reason: "Mehrere JOINs geschrieben",
    event: "query.executed",
    where: { hasJoin: true },
    count: 3,
    windowMs: 30 * MINUTE,
  },
  {
    id: "manual-where",
    featureId: "table.filter-bar",
    reason: "WHERE von Hand statt Filter",
    event: "query.executed",
    where: { ok: true, hasWhere: true },
    after: "table.opened",
    unless: "table.filtered",
    count: 2,
    windowMs: 15 * MINUTE,
  },
  {
    id: "repeat-export",
    featureId: "automation",
    reason: "Dasselbe Ziel dreimal exportiert",
    event: "export.done",
    sameKey: "target",
    count: 3,
    windowMs: 240 * MINUTE,
  },
  {
    id: "failing-queries",
    featureId: "query.ai-edit",
    reason: "Mehrere Abfragen fehlgeschlagen",
    event: "query.executed",
    where: { ok: false },
    count: 3,
    windowMs: 10 * MINUTE,
  },
  {
    id: "many-queries",
    featureId: "query.history",
    reason: "Viele verschiedene Abfragen",
    event: "query.executed",
    distinctKey: "hash",
    count: 8,
    windowMs: 30 * MINUTE,
  },
  {
    id: "table-hopping",
    featureId: "objects.search",
    reason: "Viele Tabellen nacheinander geöffnet",
    event: "table.opened",
    where: { drawer: false },
    count: 6,
    windowMs: 10 * MINUTE,
  },
];

export const PROMOTER_EVENTS = new Set(
  PROMOTER_RULES.flatMap((rule) =>
    [rule.event, rule.after, rule.unless].filter((name): name is string => Boolean(name)),
  ),
);

export const PROMOTER_WINDOW_MS = Math.max(...PROMOTER_RULES.map((rule) => rule.windowMs));

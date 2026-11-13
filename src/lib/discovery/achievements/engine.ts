import type { FeatureEntry } from "@/lib/discovery/types";
import type { FeatureUsage } from "@/lib/discovery/usage";
import type { UsageStatistics } from "@/lib/usage-statistics";
import { ACHIEVEMENTS, type Achievement, type AchievementCondition } from "./rules";

export const TRACKED_EVENTS = new Set(["query.executed", "table.filtered", "export.done"]);
export const MAX_FAMILIES = 32;

export interface AchievementInput {
  usage: FeatureUsage;
  counters: Readonly<Record<string, number>>;
  families: readonly string[];
  isCatalog: (id: string) => boolean;
}

function distinct(input: AchievementInput): number {
  let count = 0;
  for (const id in input.usage) if (input.isCatalog(id)) count++;
  return count;
}

export function conditionMet(condition: AchievementCondition, input: AchievementInput): boolean {
  if ("feature" in condition) {
    let total = 0;
    for (const id of condition.feature) total += input.usage[id]?.count ?? 0;
    return total >= (condition.count ?? 1);
  }
  if ("event" in condition) return (input.counters[condition.event] ?? 0) >= condition.count;
  if ("families" in condition) return input.families.length >= condition.families;
  return distinct(input) >= condition.distinct;
}

export function newlyUnlocked(
  input: AchievementInput,
  unlocked: Readonly<Record<string, number>>,
  rules: readonly Achievement[] = ACHIEVEMENTS,
): string[] {
  const result: string[] = [];
  for (const rule of rules) {
    if (unlocked[rule.id] !== undefined) continue;
    if (rule.any.some((condition) => conditionMet(condition, input))) result.push(rule.id);
  }
  return result;
}

export function retroactiveInput(
  statistics: UsageStatistics,
  counters: Readonly<Record<string, number>>,
  families: readonly string[],
): { counters: Record<string, number>; families: string[] } {
  let queries = 0;
  const kinds = new Set(families);
  for (const row of statistics.operations) {
    const total = row.ok + row.error + row.cancelled;
    if (row.operation === "query" || row.operation === "user-query") queries += total;
    if (row.kind !== "unknown" && total > 0) kinds.add(row.kind);
  }
  return {
    counters: {
      ...counters,
      "query.executed": Math.max(counters["query.executed"] ?? 0, queries),
    },
    families: [...kinds].slice(0, MAX_FAMILIES),
  };
}

export function nextFeature(
  rule: Achievement,
  usage: FeatureUsage,
  byId: (id: string) => FeatureEntry | undefined,
  available: (entry: FeatureEntry) => boolean = () => true,
): FeatureEntry | null {
  const candidates = [...rule.next];
  for (const id of rule.next) candidates.push(...(byId(id)?.related ?? []));
  for (const id of candidates) {
    const entry = byId(id);
    if (entry && usage[id] === undefined && available(entry)) return entry;
  }
  return null;
}

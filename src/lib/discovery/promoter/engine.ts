import type { Capabilities } from "@/lib/db";
import { featureAvailable, featureById } from "../catalog";
import type { FeatureEvent } from "../events";
import type { FeatureUsage } from "../usage";
import { PROMOTER_EVENTS, PROMOTER_RULES, PROMOTER_WINDOW_MS, type PromoterRule } from "./rules";

export const PROMOTER_MAX_WINDOW_EVENTS = 200;
export const PROMOTER_THRESHOLDS = [1, 3, 8] as const;
export const PROMOTER_RULE_COOLDOWN_MS = 24 * 60 * 60_000;
export const DEFAULT_MAX_USES = 3;

export interface PromoterStat {
  hits: number;
  shown: number;
  lastHitAt: number;
  lastShownAt: number;
  muted?: boolean;
  accepted?: boolean;
}

export interface PromoterOptions {
  rules?: readonly PromoterRule[];
  stats?: Readonly<Record<string, PromoterStat>>;
  capabilities?: Capabilities | null;
  easyMode?: boolean;
}

export function pushPromoterEvent(window: FeatureEvent[], event: FeatureEvent): boolean {
  if (!PROMOTER_EVENTS.has(event.name)) return false;
  window.push(event);
  const cutoff = event.at - PROMOTER_WINDOW_MS;
  let drop = Math.max(0, window.length - PROMOTER_MAX_WINDOW_EVENTS);
  while (drop < window.length && window[drop].at < cutoff) drop++;
  if (drop > 0) window.splice(0, drop);
  return true;
}

function matchesWhere(rule: PromoterRule, event: FeatureEvent): boolean {
  if (event.name !== rule.event) return false;
  if (!rule.where) return true;
  for (const key in rule.where) {
    const condition = rule.where[key];
    const value = event.data[key];
    if (condition !== null && typeof condition === "object") {
      if (typeof value !== "number" || value < condition.min) return false;
    } else if (value !== condition) return false;
  }
  return true;
}

export function matchRule(
  rule: PromoterRule,
  events: readonly FeatureEvent[],
  now: number,
): boolean {
  const latest = events[events.length - 1];
  if (!latest || latest.at < now - rule.windowMs || !matchesWhere(rule, latest)) return false;
  const cutoff = now - rule.windowMs;
  let start = events.length - 1;
  while (start > 0 && events[start - 1].at >= cutoff) start--;
  if (rule.after) {
    let found = -1;
    for (let index = events.length - 1; index >= start; index--) {
      if (events[index].name === rule.after) {
        found = index;
        break;
      }
    }
    if (found < 0) return false;
    start = found + 1;
  }
  const key = rule.sameKey ? latest.data[rule.sameKey] : undefined;
  if (rule.sameKey && (key === undefined || key === null)) return false;
  const distinct = rule.distinctKey ? new Set<unknown>() : null;
  let count = 0;
  for (let index = start; index < events.length; index++) {
    const event = events[index];
    if (rule.unless && event.name === rule.unless) return false;
    if (!matchesWhere(rule, event)) continue;
    if (rule.sameKey && event.data[rule.sameKey] !== key) continue;
    if (distinct && rule.distinctKey) distinct.add(event.data[rule.distinctKey]);
    else count++;
  }
  return (distinct ? distinct.size : count) >= rule.count;
}

export function ruleEligible(
  rule: PromoterRule,
  usage: FeatureUsage,
  { stats, capabilities, easyMode }: PromoterOptions,
): boolean {
  const stat = stats?.[rule.id];
  if (stat?.muted || stat?.accepted || (stat?.shown ?? 0) >= PROMOTER_THRESHOLDS.length)
    return false;
  if ((usage[rule.featureId]?.count ?? 0) >= (rule.maxUses ?? DEFAULT_MAX_USES)) return false;
  const entry = featureById(rule.featureId);
  return entry !== undefined && featureAvailable(entry, { capabilities, easyMode });
}

export function evaluatePromoterRules(
  events: readonly FeatureEvent[],
  usage: FeatureUsage,
  now: number,
  options: PromoterOptions = {},
): PromoterRule[] {
  const result: PromoterRule[] = [];
  for (const rule of options.rules ?? PROMOTER_RULES) {
    if (matchRule(rule, events, now) && ruleEligible(rule, usage, options)) result.push(rule);
  }
  return result;
}

export function promoterHit(
  stat: PromoterStat | undefined,
  rule: Pick<PromoterRule, "windowMs">,
  now: number,
): { stat: PromoterStat; show: boolean } {
  const current = stat ?? { hits: 0, shown: 0, lastHitAt: 0, lastShownAt: 0 };
  if (current.hits > 0 && now - current.lastHitAt < rule.windowMs)
    return { stat: current, show: false };
  const next = { ...current, hits: current.hits + 1, lastHitAt: now };
  const threshold = PROMOTER_THRESHOLDS[next.shown];
  const show =
    !next.muted &&
    !next.accepted &&
    threshold !== undefined &&
    next.hits >= threshold &&
    (next.shown === 0 || now - next.lastShownAt >= PROMOTER_RULE_COOLDOWN_MS);
  return { stat: next, show };
}

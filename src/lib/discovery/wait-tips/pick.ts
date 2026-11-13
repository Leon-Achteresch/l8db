import type { Capabilities, DatabaseKind } from "@/lib/db";
import { FEATURE_CATALOG, featureAvailable, featureById } from "../catalog";
import type { FeatureEntry } from "../types";
import type { FeatureUsage } from "../usage";
import { WAIT_TIPS, type WaitTip } from "./tips";

export const MAX_SEEN_TIPS = 512;

export interface WaitTipFilter {
  family: string | null;
  capabilities: Capabilities | null;
  easyMode: boolean;
  usage: FeatureUsage;
}

function tipAvailable(tip: WaitTip, filter: WaitTipFilter): boolean {
  if (tip.families && !tip.families.includes(filter.family as DatabaseKind)) return false;
  const options = { capabilities: filter.capabilities, easyMode: filter.easyMode };
  if (tip.capability && !featureAvailable({ capability: tip.capability } as FeatureEntry, options))
    return false;
  if (!tip.featureId) return true;
  const entry = featureById(tip.featureId);
  return entry !== undefined && featureAvailable(entry, options);
}

export function waitTipsFor(
  filter: WaitTipFilter,
  curated: readonly WaitTip[] = WAIT_TIPS,
  catalog: readonly FeatureEntry[] = FEATURE_CATALOG,
): WaitTip[] {
  const options = { capabilities: filter.capabilities, easyMode: filter.easyMode };
  const own = curated.filter((tip) => tipAvailable(tip, filter));
  const fromCatalog = catalog
    .filter((entry) => !filter.usage[entry.id] && featureAvailable(entry, options))
    .map((entry) => ({
      id: `catalog:${entry.id}`,
      text: `${entry.title}: ${entry.summary}`,
      featureId: entry.id,
    }));
  const result: WaitTip[] = [];
  for (let index = 0; index < Math.max(own.length, fromCatalog.length); index++) {
    if (own[index]) result.push(own[index]);
    if (fromCatalog[index]) result.push(fromCatalog[index]);
  }
  return result;
}

export function pickWaitTip(
  tips: readonly WaitTip[],
  seen: readonly string[],
): { tip: WaitTip | null; seen: string[] } {
  if (tips.length === 0) return { tip: null, seen: [...seen] };
  const seenSet = new Set(seen);
  let tip = tips.find((candidate) => !seenSet.has(candidate.id));
  let base = [...seen];
  if (!tip) {
    const round = new Set(tips.map((candidate) => candidate.id));
    base = base.filter((id) => !round.has(id));
    tip = tips[0];
  }
  base.push(tip.id);
  return { tip, seen: base.length > MAX_SEEN_TIPS ? base.slice(-MAX_SEEN_TIPS) : base };
}

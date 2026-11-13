import type { ConvexRecentError } from "@/lib/db/convex-studio-settings";

export interface ConvexInsight {
  identifier: string;
  udfType: string | null;
  message: string;
  count: number;
  last: number;
}

const INSIGHT_LIMIT = 20;

export function groupRecentErrors(errors: ConvexRecentError[]): ConvexInsight[] {
  const groups = new Map<string, ConvexInsight>();
  for (const error of errors) {
    const message = error.message.split("\n", 1)[0];
    const key = `${error.identifier}\n${message}`;
    const group = groups.get(key);
    if (group) {
      group.count++;
      group.last = Math.max(group.last, error.timestamp);
    } else {
      groups.set(key, {
        identifier: error.identifier,
        udfType: error.udfType,
        message,
        count: 1,
        last: error.timestamp,
      });
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, INSIGHT_LIMIT);
}

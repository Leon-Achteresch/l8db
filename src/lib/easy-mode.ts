import type { Tab } from "@/lib/table-tabs/types";

const advancedRoutes = new Set([
  "mcp",
  "versioning",
  "monitor",
  "sessions",
  "replication",
  "compare",
  "er-diagram",
  "saved-plan",
  "invalid-objects",
  "enums",
  "sequences",
  "dev",
]);

export function isEasyModeRouteVisible(pathname: string, easyMode: boolean): boolean {
  return !easyMode || !advancedRoutes.has(pathname.split("/")[1]);
}

export function isEasyModeTabVisible(tab: Tab, easyMode: boolean): boolean {
  return tab.kind !== "tool" || isEasyModeRouteVisible(`/${tab.tool}`, easyMode);
}

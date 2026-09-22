import type { Capabilities } from "@/lib/db";

export type TableDetailTab =
  | "data"
  | "columns"
  | "definition"
  | "triggers"
  | "indexes"
  | "constraints"
  | "rls"
  | "partitions"
  | "grants"
  | "used-by"
  | "performance"
  | "audit";

export const TABLE_DETAIL_TABS: {
  id: TableDetailTab;
  label: string;
  entity?: "table" | "view";
  capability?: keyof Capabilities;
}[] = [
  { id: "data", label: "Daten" },
  { id: "columns", label: "Columns" },
  { id: "definition", label: "Definition", entity: "view" },
  { id: "triggers", label: "Trigger", entity: "table", capability: "triggers" },
  { id: "indexes", label: "Indexes", entity: "table", capability: "indexes" },
  { id: "constraints", label: "Constraints", entity: "table", capability: "constraints" },
  { id: "rls", label: "RLS", entity: "table", capability: "rls" },
  { id: "partitions", label: "Partitionen", entity: "table", capability: "partitions" },
  { id: "grants", label: "Grants", capability: "object_grants" },
  { id: "used-by", label: "Used By", capability: "used_by" },
  { id: "performance", label: "Performance" },
  { id: "audit", label: "Audit", capability: "object_admin" },
];

export function availableTableDetailTabs(isView: boolean, caps: Capabilities, easyMode = false) {
  return TABLE_DETAIL_TABS.filter(
    (tab) =>
      (!easyMode || tab.id === "data" || tab.id === "columns" || tab.id === "definition") &&
      (!tab.entity || tab.entity === (isView ? "view" : "table")) &&
      (!tab.capability || caps[tab.capability]) &&
      (tab.id !== "performance" || caps.query_language !== "redis"),
  );
}

export function resolveTableDetailTab(
  selected: TableDetailTab,
  visible: { id: TableDetailTab }[],
): TableDetailTab | "" {
  return visible.some((tab) => tab.id === selected) ? selected : (visible[0]?.id ?? "");
}

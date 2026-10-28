import { FilterOmnibar } from "@/features/table/filter-bar/filter-omnibar";
import { FilterPillBar } from "@/features/table/filter-bar/filter-pill-bar";
import type { FilterBarProps } from "@/features/table/filter-bar/use-filter-bar-model";
import { TableFilterPanel } from "@/features/table/table-filter-panel";
import { useActiveCapabilities } from "@/lib/db-selection";
import { useSettingsStore } from "@/lib/settings";

export function TableFilterBar(props: FilterBarProps) {
  const style = useSettingsStore((state) => state.filterBarStyle);
  const redis = useActiveCapabilities().query_language === "redis";
  if (style === "classic" || redis) return <TableFilterPanel {...props} />;
  return style === "omnibar" ? <FilterOmnibar {...props} /> : <FilterPillBar {...props} />;
}

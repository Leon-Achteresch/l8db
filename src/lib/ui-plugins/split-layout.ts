import { useSplitView } from "@/lib/split-view";
import type { SplitLayout } from "./api";
import { useUiPluginRegistry } from "./store";

export function defaultSplitLayout(
  count: number,
  orientation: "horizontal" | "vertical",
): SplitLayout {
  if (count === 2) return orientation === "horizontal" ? "columns" : "rows";
  return count === 3 ? "leftStack" : "grid";
}

export function useSplitLayout(): SplitLayout {
  const count = useSplitView((state) => state.panes.length);
  const orientation = useSplitView((state) => state.orientation);
  const layout = useUiPluginRegistry((registry) => registry.splitLayout);
  return (count > 1 && layout?.(count, orientation)) || defaultSplitLayout(count, orientation);
}

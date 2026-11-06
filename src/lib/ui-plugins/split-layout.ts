import { useMemo } from "react";
import { autoLayout, type SplitTree } from "@/lib/split-layout";
import { useSplitView } from "@/lib/split-view";
import { useUiPluginRegistry } from "./store";

export { defaultSplitLayout } from "@/lib/split-layout";

export function useSplitLayout(): SplitTree {
  const count = useSplitView((state) => state.panes.length);
  const orientation = useSplitView((state) => state.orientation);
  const stored = useSplitView((state) => state.layout);
  const plugin = useUiPluginRegistry((registry) => registry.splitLayout);
  return useMemo(
    () => stored ?? autoLayout(count, orientation, plugin),
    [stored, count, orientation, plugin],
  );
}

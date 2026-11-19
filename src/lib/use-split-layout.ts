import { useMemo } from "react";
import { autoLayout, type SplitTree } from "@/lib/split-layout";
import { useSplitView } from "@/lib/split-view";

export function useSplitLayout(): SplitTree {
  const count = useSplitView((state) => state.panes.length);
  const orientation = useSplitView((state) => state.orientation);
  const stored = useSplitView((state) => state.layout);
  return useMemo(() => stored ?? autoLayout(count, orientation), [stored, count, orientation]);
}

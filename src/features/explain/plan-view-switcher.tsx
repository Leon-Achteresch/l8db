import { ArrowDownIcon, ArrowRightIcon, FlameIcon, ListTreeIcon, NetworkIcon } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type ExplainGraphDirection,
  type ExplainViewMode,
  useExplainViewPrefs,
} from "@/lib/explain-view-prefs";

export function PlanViewSwitcher() {
  const view = useExplainViewPrefs((state) => state.view);
  const direction = useExplainViewPrefs((state) => state.direction);
  const setView = useExplainViewPrefs((state) => state.setView);
  const setDirection = useExplainViewPrefs((state) => state.setDirection);
  return (
    <div className="flex items-center gap-1">
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        spacing={0}
        value={view}
        onValueChange={(value) => value && setView(value as ExplainViewMode)}
        aria-label="Planansicht"
      >
        <ToggleGroupItem value="tree" className="h-7 gap-1 px-2 text-xs" title="Baumansicht">
          <ListTreeIcon className="size-3.5" />
          Baum
        </ToggleGroupItem>
        <ToggleGroupItem value="graph" className="h-7 gap-1 px-2 text-xs" title="Operator-Graph">
          <NetworkIcon className="size-3.5" />
          Graph
        </ToggleGroupItem>
        <ToggleGroupItem
          value="flame"
          className="h-7 gap-1 px-2 text-xs"
          title="Flame-Graph (Icicle)"
        >
          <FlameIcon className="size-3.5" />
          Flame
        </ToggleGroupItem>
      </ToggleGroup>
      {view === "graph" && (
        <ToggleGroup
          type="single"
          size="sm"
          value={direction}
          onValueChange={(value) => value && setDirection(value as ExplainGraphDirection)}
          aria-label="Graph-Richtung"
        >
          <ToggleGroupItem value="DOWN" className="size-7" title="Von oben nach unten">
            <ArrowDownIcon className="size-3.5" />
          </ToggleGroupItem>
          <ToggleGroupItem value="RIGHT" className="size-7" title="Von links nach rechts">
            <ArrowRightIcon className="size-3.5" />
          </ToggleGroupItem>
        </ToggleGroup>
      )}
    </div>
  );
}

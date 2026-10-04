import { ListIcon, WorkflowIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type StepViewMode, useAutomationUiState } from "@/lib/automation/ui-state";

interface Props {
  forced: boolean;
}

export function StepViewSwitch({ forced }: Props) {
  const stored = useAutomationUiState((state) => state.stepView);
  const setStepView = useAutomationUiState((state) => state.setStepView);
  const value: StepViewMode = forced ? "list" : stored;

  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      spacing={0}
      value={value}
      onValueChange={(next) => next && setStepView(next as StepViewMode)}
      aria-label="Darstellung der Schritte"
      data-testid="automation-step-view"
    >
      <ToggleGroupItem
        value="graph"
        disabled={forced}
        title={forced ? "Für den Graphen ist der Bereich zu schmal" : "Ablauf als Graph"}
        className="h-7 gap-1 px-2.5 text-xs"
      >
        <WorkflowIcon className="size-3.5" />
        Graph
      </ToggleGroupItem>
      <ToggleGroupItem value="list" title="Schritte als Liste" className="h-7 gap-1 px-2.5 text-xs">
        <ListIcon className="size-3.5" />
        Liste
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

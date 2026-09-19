import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ERDiagramInner } from "@/features/er-diagram/er-diagram-view/er-diagram-inner";

export function ErDiagramView() {
  return (
    <div data-tour="er-page" className="flex h-full min-h-0 flex-1 flex-col">
      <ReactFlowProvider>
        <ERDiagramInner />
      </ReactFlowProvider>
    </div>
  );
}

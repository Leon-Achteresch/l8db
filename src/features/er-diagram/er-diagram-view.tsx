import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ERDiagramInner } from "@/features/er-diagram/er-diagram-view/er-diagram-inner";
import { UnavailableView } from "@/features/shell/unavailable-view";
import { useActiveConnection } from "@/lib/connections";
import { supports } from "@/lib/providers";

export function ErDiagramView() {
  const connection = useActiveConnection();
  if (connection && !supports(connection, "foreign_keys")) return <UnavailableView />;
  return (
    <div data-tour="er-page" className="flex h-full min-h-0 flex-1 flex-col">
      <ReactFlowProvider>
        <ERDiagramInner />
      </ReactFlowProvider>
    </div>
  );
}

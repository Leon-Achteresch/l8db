import { createPortal } from "react-dom";
import { PanelErrorBoundary } from "@/components/error-boundary/panel-error-boundary";
import { ConnectionScopeContext } from "@/lib/connections";
import { WorkbenchContext, WorkbenchDatabaseContext } from "@/lib/workbench-context";
import { useWorkbenchTabs } from "@/lib/workbench-tabs";

export function WorkbenchHost() {
  const entries = useWorkbenchTabs((state) => state.entries);
  return entries.map((entry) =>
    createPortal(
      <ConnectionScopeContext.Provider value={entry.connectionId}>
        <WorkbenchDatabaseContext.Provider value={{ database: entry.database }}>
          <WorkbenchContext.Provider value={entry.id}>
            <PanelErrorBoundary label={entry.title} source="workbench-tab">
              {entry.content}
            </PanelErrorBoundary>
          </WorkbenchContext.Provider>
        </WorkbenchDatabaseContext.Provider>
      </ConnectionScopeContext.Provider>,
      entry.container,
      entry.id,
    ),
  );
}

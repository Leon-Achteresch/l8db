import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SplitPane } from "@/features/shell/split-pane";
import { MasterDetailLinks } from "@/features/shell/split-workspace/master-detail-links";
import { NewPaneDropZone } from "@/features/shell/split-workspace/new-pane-drop-zone";
import { useSplitView } from "@/lib/split-view";
import { tabKey, useTableTabs } from "@/lib/table-tabs";

export function SplitWorkspace() {
  const orientation = useSplitView((state) => state.orientation);
  const panes = useSplitView((state) => state.panes);
  const focusedPane = useSplitView((state) => state.focusedPane);
  const focusPane = useSplitView((state) => state.focusPane);
  const closePane = useSplitView((state) => state.closePane);
  const tabs = useTableTabs((state) => state.tabs);

  const pane = (index: number) => {
    const key = panes[index];
    return (
      <ResizablePanel id={`split-${index}`} minSize="18%" className="min-h-0 min-w-0">
        <SplitPane
          index={index}
          focused={focusedPane === index}
          tab={key ? tabs.find((item) => tabKey(item) === key) : undefined}
          onFocus={() => focusPane(index)}
          onClose={() => closePane(index)}
        />
      </ResizablePanel>
    );
  };

  const layout =
    panes.length === 2 ? (
      <ResizablePanelGroup orientation={orientation} className="h-full min-h-0 flex-1">
        {pane(0)}
        <ResizableHandle withHandle />
        {pane(1)}
      </ResizablePanelGroup>
    ) : panes.length === 3 ? (
      <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0 flex-1">
        {pane(0)}
        <ResizableHandle withHandle />
        <ResizablePanel id="split-stack" minSize="18%" className="min-h-0 min-w-0">
          <ResizablePanelGroup orientation="vertical" className="h-full">
            {pane(1)}
            <ResizableHandle withHandle />
            {pane(2)}
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    ) : (
      <ResizablePanelGroup orientation="vertical" className="h-full min-h-0 flex-1">
        <ResizablePanel id="split-top" minSize="18%" className="min-h-0 min-w-0">
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            {pane(0)}
            <ResizableHandle withHandle />
            {pane(1)}
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="split-bottom" minSize="18%" className="min-h-0 min-w-0">
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            {pane(2)}
            <ResizableHandle withHandle />
            {pane(3)}
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    );

  return (
    <>
      {layout}
      <MasterDetailLinks />
      <NewPaneDropZone />
    </>
  );
}
export { NewPaneDropZone };

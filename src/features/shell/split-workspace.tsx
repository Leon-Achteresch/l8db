import { useDragOperation, useDroppable } from "@dnd-kit/react";

import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { MasterDetailLink } from "@/features/shell/master-detail-link";
import { SplitPane } from "@/features/shell/split-pane";
import { MAX_SPLIT_PANES, useSplitView } from "@/lib/split-view";
import { tabKey, useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

export function NewPaneDropZone() {
  const { source } = useDragOperation();
  const full = useSplitView((state) => state.panes.length >= MAX_SPLIT_PANES);
  const { ref, isDropTarget } = useDroppable({ id: "pane:new", type: "pane", accept: ["tab"] });
  if (source?.type !== "tab" || full) return null;
  return (
    <div
      ref={ref}
      className={cn(
        "absolute inset-y-2 right-2 z-20 flex w-24 items-center justify-center rounded-lg border-2 border-dashed text-center text-xs transition-colors",
        isDropTarget
          ? "border-primary bg-primary/15 text-foreground"
          : "border-border bg-background/80 text-muted-foreground",
      )}
    >
      Neuer Bereich
    </div>
  );
}

export function SplitWorkspace() {
  const panes = useSplitView((state) => state.panes);
  const focusedPane = useSplitView((state) => state.focusedPane);
  const focusPane = useSplitView((state) => state.focusPane);
  const closePane = useSplitView((state) => state.closePane);
  const tabs = useTableTabs((state) => state.tabs);

  const link = (index: number, vertical = false) => (
    <MasterDetailLink
      key={`${panes[0]}|${panes[index]}`}
      master={tabs.find((item) => tabKey(item) === panes[0])}
      detail={tabs.find((item) => tabKey(item) === panes[index])}
      detailIndex={index}
      vertical={vertical}
    />
  );

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
      <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0 flex-1">
        {pane(0)}
        {link(1)}
        {pane(1)}
      </ResizablePanelGroup>
    ) : panes.length === 3 ? (
      <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0 flex-1">
        {pane(0)}
        {link(1)}
        <ResizablePanel id="split-stack" minSize="18%" className="min-h-0 min-w-0">
          <ResizablePanelGroup orientation="vertical" className="h-full">
            {pane(1)}
            {link(2, true)}
            {pane(2)}
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    ) : (
      <ResizablePanelGroup orientation="vertical" className="h-full min-h-0 flex-1">
        <ResizablePanel id="split-top" minSize="18%" className="min-h-0 min-w-0">
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            {pane(0)}
            {link(1)}
            {pane(1)}
          </ResizablePanelGroup>
        </ResizablePanel>
        {link(2, true)}
        <ResizablePanel id="split-bottom" minSize="18%" className="min-h-0 min-w-0">
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            {pane(2)}
            {link(3)}
            {pane(3)}
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    );

  return (
    <>
      {layout}
      <NewPaneDropZone />
    </>
  );
}

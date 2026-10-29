import type { ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SplitPane } from "@/features/shell/split-pane";
import { MasterDetailLinks } from "@/features/shell/split-workspace/master-detail-links";
import { NewPaneDropZone } from "@/features/shell/split-workspace/new-pane-drop-zone";
import { usePaneTabs, useSplitView } from "@/lib/split-view";
import { useSplitLayout } from "@/lib/ui-plugins/split-layout";

type Direction = "horizontal" | "vertical";

export function SplitWorkspace() {
  const panes = useSplitView((state) => state.panes);
  const focusedPane = useSplitView((state) => state.focusedPane);
  const focusPane = useSplitView((state) => state.focusPane);
  const closePane = useSplitView((state) => state.closePane);
  const paneTabs = usePaneTabs();
  const layout = useSplitLayout();

  const pane = (index: number) => (
    <ResizablePanel
      key={`split-${index}`}
      id={`split-${index}`}
      minSize="18%"
      className="min-h-0 min-w-0"
    >
      <SplitPane
        index={index}
        focused={focusedPane === index}
        tab={paneTabs[index]}
        onFocus={() => focusPane(index)}
        onClose={() => closePane(index)}
      />
    </ResizablePanel>
  );
  const handle = (key: string) => <ResizableHandle key={key} withHandle />;
  const line = (indexes: number[]) =>
    indexes.flatMap((index, at) =>
      at === 0 ? [pane(index)] : [handle(`handle-${index}`), pane(index)],
    );
  const nested = (id: string, direction: Direction, indexes: number[]) => (
    <ResizablePanel key={id} id={id} minSize="18%" className="min-h-0 min-w-0">
      <ResizablePanelGroup orientation={direction} className="h-full">
        {line(indexes)}
      </ResizablePanelGroup>
    </ResizablePanel>
  );
  const outer = (direction: Direction, children: ReactNode) => (
    <ResizablePanelGroup orientation={direction} className="h-full min-h-0 flex-1">
      {children}
    </ResizablePanelGroup>
  );
  const all = panes.map((_, index) => index);
  const [first, ...rest] = all;

  const content =
    layout === "rows" || (all.length === 2 && layout === "topStack")
      ? outer("vertical", line(all))
      : layout === "columns" || all.length === 2
        ? outer("horizontal", line(all))
        : layout === "leftStack"
          ? outer("horizontal", [
              pane(first),
              handle("stack"),
              nested("split-stack", "vertical", rest),
            ])
          : layout === "topStack"
            ? outer("vertical", [
                pane(first),
                handle("bottom"),
                nested("split-bottom", "horizontal", rest),
              ])
            : outer("vertical", [
                nested("split-top", "horizontal", all.slice(0, 2)),
                handle("bottom"),
                all.length === 3 ? pane(2) : nested("split-bottom", "horizontal", all.slice(2)),
              ]);

  return (
    <>
      {content}
      <MasterDetailLinks />
      <NewPaneDropZone />
    </>
  );
}
export { NewPaneDropZone };

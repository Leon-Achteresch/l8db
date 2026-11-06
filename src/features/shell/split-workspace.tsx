import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SplitPane } from "@/features/shell/split-pane";
import { MasterDetailLinks } from "@/features/shell/split-workspace/master-detail-links";
import type { SplitTree } from "@/lib/split-layout";
import { useSplitView } from "@/lib/split-view";
import { useSplitLayout } from "@/lib/ui-plugins/split-layout";

export function SplitWorkspace() {
  const focusedPane = useSplitView((state) => state.focusedPane);
  const layout = useSplitLayout();
  let next = 0;

  const render = (node: SplitTree, id: string): React.ReactNode => {
    if (!node) {
      const index = next++;
      return <SplitPane index={index} focused={focusedPane === index} />;
    }
    return (
      <ResizablePanelGroup
        orientation={node.dir === "row" ? "horizontal" : "vertical"}
        className="h-full min-h-0 flex-1"
      >
        {node.children.flatMap((child, at) => {
          const childId = child === null ? `split-${next}` : `${id}-${at}`;
          const panel = (
            <ResizablePanel key={childId} id={childId} minSize="18%" className="min-h-0 min-w-0">
              {render(child, childId)}
            </ResizablePanel>
          );
          return at === 0
            ? [panel]
            : [<ResizableHandle key={`${childId}-handle`} withHandle />, panel];
        })}
      </ResizablePanelGroup>
    );
  };

  return (
    <>
      {render(layout, "split-group")}
      <MasterDetailLinks />
    </>
  );
}

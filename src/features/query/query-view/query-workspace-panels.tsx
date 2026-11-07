import { type ReactNode, useLayoutEffect, useState } from "react";
import { type useGroupRef, usePanelRef } from "react-resizable-panels";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useQueryWorkspace } from "@/lib/query-workspace";

import type { QueryWorkspaceState } from "./types";

interface QueryWorkspacePanelsProps {
  workspace: QueryWorkspaceState;
  workspaceGroup: ReturnType<typeof useGroupRef>;
  editorFocus: boolean;
  resultFocus: boolean;
  navigator: ReactNode;
  editor: ReactNode;
  results: ReactNode;
}

export function QueryWorkspacePanels({
  workspace,
  workspaceGroup,
  editorFocus,
  resultFocus,
  navigator,
  editor,
  results,
}: QueryWorkspacePanelsProps) {
  const navigatorVisible = useQueryWorkspace((state) => state.navigatorVisible);
  const navigatorShare = useQueryWorkspace((state) => state.navigatorShare);
  const navigatorPanel = usePanelRef();
  const hasNavigator = Boolean(navigator);
  const showNavigator = navigatorVisible && hasNavigator;
  const [navigatorDefaultSize] = useState(() => (showNavigator ? `${navigatorShare}%` : "0%"));

  useLayoutEffect(() => {
    const sync = (state: { navigatorVisible: boolean; navigatorShare: number }) => {
      const panel = navigatorPanel.current;
      const show = state.navigatorVisible && hasNavigator;
      if (!panel || show !== panel.isCollapsed()) return;
      if (show) {
        panel.resize(`${state.navigatorShare}%`);
        if (panel.isCollapsed()) panel.resize("180px");
      } else panel.collapse();
    };
    sync(useQueryWorkspace.getState());
    return useQueryWorkspace.subscribe(sync);
  }, [hasNavigator, navigatorPanel]);

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1"
      onLayoutChanged={(layout) => {
        if (layout.navigator && Math.abs(layout.navigator - navigatorShare) > 0.1)
          workspace.update({ navigatorShare: layout.navigator });
      }}
    >
      <ResizablePanel
        id="navigator"
        panelRef={navigatorPanel}
        collapsible
        collapsedThreshold="180px"
        defaultSize={navigatorDefaultSize}
        minSize="180px"
        maxSize="40%"
        onResize={(size) => {
          if (!hasNavigator || Number.isNaN(size.asPercentage)) return;
          const open = size.asPercentage > 0;
          if (open !== useQueryWorkspace.getState().navigatorVisible)
            workspace.update({ navigatorVisible: open });
        }}
      >
        {showNavigator && navigator}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        disableDoubleClick
        disabled={!showNavigator}
        className={showNavigator ? undefined : "hidden"}
      />
      <ResizablePanel id="query-workspace" minSize="50%" className="min-w-0">
        <ResizablePanelGroup
          groupRef={workspaceGroup}
          orientation={workspace.layout}
          className="min-h-0 flex-1"
          onLayoutChanged={(layout) => {
            if (
              !editorFocus &&
              !resultFocus &&
              layout.editor &&
              layout.results &&
              Math.abs(layout.editor - workspace.editorShare) > 0.1
            )
              workspace.update({ editorShare: layout.editor });
          }}
        >
          {!resultFocus && (
            <ResizablePanel
              id="editor"
              defaultSize={`${workspace.editorShare}%`}
              minSize="20%"
              className="flex min-h-0 flex-col"
            >
              {editor}
            </ResizablePanel>
          )}
          {!editorFocus && !resultFocus && <ResizableHandle withHandle />}
          {!editorFocus && (
            <ResizablePanel
              id="results"
              minSize="20%"
              defaultSize={`${100 - workspace.editorShare}%`}
              className="flex min-h-0 flex-col overflow-hidden"
            >
              {results}
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

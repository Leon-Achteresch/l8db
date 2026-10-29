import type { ReactNode } from "react";
import type { useGroupRef } from "react-resizable-panels";

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
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1"
      onLayoutChanged={(layout) => {
        if (layout.navigator && Math.abs(layout.navigator - navigatorShare) > 0.1)
          workspace.update({ navigatorShare: layout.navigator });
      }}
    >
      {navigatorVisible && navigator && (
        <>
          <ResizablePanel
            id="navigator"
            defaultSize={`${navigatorShare}%`}
            minSize="180px"
            maxSize="40%"
          >
            {navigator}
          </ResizablePanel>
          <ResizableHandle withHandle />
        </>
      )}
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

import type { ReactNode } from "react";
import type { useGroupRef } from "react-resizable-panels";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

import type { QueryWorkspaceState } from "./types";

interface QueryWorkspacePanelsProps {
  workspace: QueryWorkspaceState;
  workspaceGroup: ReturnType<typeof useGroupRef>;
  editorFocus: boolean;
  navigator: ReactNode;
  editor: ReactNode;
  results: ReactNode;
}

export function QueryWorkspacePanels({
  workspace,
  workspaceGroup,
  editorFocus,
  navigator,
  editor,
  results,
}: QueryWorkspacePanelsProps) {
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1"
      onLayoutChanged={(layout) => {
        if (layout.navigator && Math.abs(layout.navigator - workspace.navigatorShare) > 0.1)
          workspace.update({ navigatorShare: layout.navigator });
      }}
    >
      {navigator && (
        <>
          <ResizablePanel
            id="navigator"
            defaultSize={`${workspace.navigatorShare}%`}
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
              layout.editor &&
              layout.results &&
              Math.abs(layout.editor - workspace.editorShare) > 0.1
            )
              workspace.update({ editorShare: layout.editor });
          }}
        >
          <ResizablePanel
            id="editor"
            defaultSize={`${workspace.editorShare}%`}
            minSize="20%"
            className="flex min-h-0 flex-col"
          >
            {editor}
          </ResizablePanel>
          {!editorFocus && <ResizableHandle withHandle />}
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

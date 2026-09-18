import { useEffect } from "react";
import type { useGroupRef } from "react-resizable-panels";

import type { QueryWorkspaceState } from "./types";

export function useWorkspaceLayoutSync(
  workspaceGroup: ReturnType<typeof useGroupRef>,
  workspace: QueryWorkspaceState,
  editorFocus: boolean,
) {
  useEffect(() => {
    if (editorFocus) return;
    const group = workspaceGroup.current;
    const layout = group?.getLayout();
    if (
      group &&
      layout?.editor !== undefined &&
      layout.results !== undefined &&
      Math.abs(layout.editor - workspace.editorShare) > 0.1
    ) {
      group.setLayout({ editor: workspace.editorShare, results: 100 - workspace.editorShare });
    }
  }, [workspace.editorShare, workspace.layout, editorFocus, workspaceGroup]);
}

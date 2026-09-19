import { type RefObject, useEffect } from "react";

import type { monaco } from "@/lib/monaco";
import { useQueryWorkspace } from "@/lib/query-workspace";

export function useWorkspaceEditorOptions(
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
) {
  const workspace = useQueryWorkspace();
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({
      folding: workspace.folding,
      showFoldingControls: "always",
      stickyScroll: { enabled: workspace.stickyScroll },
      cursorStyle: workspace.cursorStyle,
      cursorBlinking: workspace.cursorBlinking,
      renderLineHighlight: workspace.highlightLine ? "line" : "none",
      scrollBeyondLastLine: workspace.scrollBeyondLastLine,
      autoClosingBrackets: workspace.autoClosing ? "languageDefined" : "never",
      autoClosingQuotes: workspace.autoClosing ? "languageDefined" : "never",
    });
    editor.getModel()?.updateOptions({ insertSpaces: workspace.insertSpaces });
  }, [workspace]);
}

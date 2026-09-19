import { type RefObject, useEffect } from "react";

import type { QueryEditorApi } from "@/features/query/query-editor-pane";
import { useQueryRevealStore } from "@/lib/query-reveal";

export function useRevealRequest(tabId: string, editorApiRef: RefObject<QueryEditorApi | null>) {
  const revealRequest = useQueryRevealStore((state) => state.request);
  const clearReveal = useQueryRevealStore((state) => state.clearReveal);

  useEffect(() => {
    if (!revealRequest || revealRequest.tabId !== tabId) return;
    const timer = setTimeout(() => {
      editorApiRef.current?.revealMatch(
        revealRequest.line,
        revealRequest.column,
        revealRequest.length,
      );
      clearReveal(tabId);
    }, 0);
    return () => clearTimeout(timer);
  }, [revealRequest, tabId, clearReveal, editorApiRef]);
}

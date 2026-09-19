import { type RefObject, useEffect } from "react";

import { monaco } from "@/lib/monaco";

import type { EditorHighlight } from "./types";

export function useStatementHighlight(
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  decorationsRef: RefObject<monaco.editor.IEditorDecorationsCollection | null>,
  highlight: EditorHighlight | null | undefined,
) {
  useEffect(() => {
    const editor = editorRef.current;
    const decorations = decorationsRef.current;
    const model = editor?.getModel();
    if (!decorations || !model) return;
    if (!highlight || highlight.end <= highlight.start || highlight.end > model.getValueLength()) {
      decorations.clear();
      return;
    }
    const start = model.getPositionAt(highlight.start);
    const end = model.getPositionAt(highlight.end);
    decorations.set([
      {
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        options: {
          className: "l8db-statement-highlight",
          isWholeLine: false,
        },
      },
    ]);
  }, [highlight]);
}

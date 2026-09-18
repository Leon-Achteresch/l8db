import type { RefObject } from "react";

import { monaco } from "@/lib/monaco";
import { toMonacoSnippet } from "@/lib/snippets";

import type { QueryEditorApi } from "./types";

export function createEditorApi(
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  toggleBookmarkAtCursor: () => void,
  gotoBookmarkLine: (direction: "next" | "previous") => void,
): QueryEditorApi {
  return {
    insertText: (text: string) => {
      const editor = editorRef.current;
      const selection = editor?.getSelection();
      if (!editor || !selection) return;
      editor.pushUndoStop();
      editor.executeEdits("schema-browser", [{ range: selection, text, forceMoveMarkers: true }]);
      editor.pushUndoStop();
      editor.focus();
    },
    insertSnippet: (body: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      editor.trigger("l8db-snippets", "editor.action.insertSnippet", {
        snippet: toMonacoSnippet(body),
      });
    },
    focus: () => editorRef.current?.focus(),
    action: (id: string) => {
      editorRef.current?.focus();
      editorRef.current?.trigger("query-workspace", id, null);
    },
    format: () => {
      editorRef.current?.getAction("editor.action.formatDocument")?.run();
    },
    toggleComment: () => {
      editorRef.current?.getAction("editor.action.commentLine")?.run();
    },
    revealMatch: (line: number, column = 1, length = 0) => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model) return;
      const targetLine = Math.max(1, Math.min(line, model.getLineCount()));
      const maxColumn = model.getLineMaxColumn(targetLine);
      const startColumn = Math.max(1, Math.min(column, maxColumn));
      const endColumn = Math.max(startColumn, Math.min(startColumn + length, maxColumn));
      editor.setSelection(new monaco.Range(targetLine, startColumn, targetLine, endColumn));
      editor.revealLineInCenter(targetLine);
      editor.focus();
    },
    toggleBookmark: () => toggleBookmarkAtCursor(),
    gotoBookmark: (direction: "next" | "previous") => gotoBookmarkLine(direction),
  };
}

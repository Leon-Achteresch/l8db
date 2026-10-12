import { type RefObject, useEffect, useRef } from "react";
import { applyDefinitionHunk, definitionHunks } from "@/lib/definition-merge";
import { monaco } from "@/lib/monaco";

export function useDefinitionDraftActions(
  diffRef: RefObject<monaco.editor.IStandaloneDiffEditor | null>,
  original: string,
  modified: string,
  draft: string | undefined,
  onDraftChange?: (value: string) => void,
  onSideSelect?: (side: "left" | "right") => void,
) {
  const callbacks = useRef({ onDraftChange, onSideSelect });
  callbacks.current = { onDraftChange, onSideSelect };

  useEffect(() => {
    const diff = diffRef.current;
    if (!diff) return;
    diff.updateOptions({ glyphMargin: draft !== undefined });
    if (draft === undefined) return;

    const cleanups = (["left", "right"] as const).map((side) => {
      const editor = side === "left" ? diff.getOriginalEditor() : diff.getModifiedEditor();
      const source = side === "left" ? original : modified;
      const hunks = definitionHunks(source, draft);
      const lineCount = editor.getModel()?.getLineCount() ?? 1;
      const hunkLine = (start: number) => Math.min(start + 1, lineCount);
      const title = `Änderung aus ${side === "left" ? "der Quelle" : "dem Ziel"} in den Entwurf übernehmen`;
      const decorations = editor.createDecorationsCollection(
        hunks.map((hunk) => ({
          range: new monaco.Range(hunkLine(hunk.sourceStart), 1, hunkLine(hunk.sourceStart), 1),
          options: {
            glyphMarginClassName: "merge-hunk-apply codicon-arrow-down",
            glyphMarginHoverMessage: { value: title },
          },
        })),
      );
      const focus = editor.onDidFocusEditorWidget(() => callbacks.current.onSideSelect?.(side));
      const click = editor.onMouseDown((event) => {
        if (
          event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
          !event.target.position
        )
          return;
        const line = event.target.position.lineNumber;
        const hunk = hunks.find((item) => hunkLine(item.sourceStart) === line);
        if (!hunk) return;
        callbacks.current.onSideSelect?.(side);
        callbacks.current.onDraftChange?.(applyDefinitionHunk(source, draft, hunk));
      });
      return () => {
        focus.dispose();
        click.dispose();
        decorations.clear();
      };
    });
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [diffRef, original, modified, draft]);
}

import * as monaco from "monaco-editor/editor/editor.api";
import type { HiddenRange } from "../../../packages/extension-api/src";

type HiddenAreasEditor = monaco.editor.ICodeEditor & {
  setHiddenAreas(ranges: monaco.IRange[], source?: unknown): void;
};

const MARKER = "extension-hidden-marker";
const LEADING = `${MARKER}-leading`;
const sources = new WeakMap<monaco.editor.ICodeEditor, object>();

export function attachHiddenRanges(
  editor: monaco.editor.ICodeEditor,
  onReveal: (line: number) => void,
) {
  const source = sources.get(editor) ?? {};
  sources.set(editor, source);
  const decorations = editor.createDecorationsCollection();
  let markers = new Map<string, number>();
  let hidden: HiddenRange[] = [];
  const revealAt = (line: number) => {
    if (hidden.some((range) => range.startLine <= line && line <= range.endLine)) onReveal(line);
  };
  const set = (ranges: HiddenRange[]) => {
    const model = editor.getModel();
    if (!model) return;
    const cursors = (editor.getSelections() ?? []).map((selection) => selection.positionLineNumber);
    hidden = ranges;
    (editor as HiddenAreasEditor).setHiddenAreas(
      ranges.map((range) => new monaco.Range(range.startLine, 1, range.endLine, 1)),
      source,
    );
    markers = new Map();
    decorations.set(
      ranges.map((range) => {
        const count = range.endLine - range.startLine + 1;
        const leading = range.startLine === 1;
        const line = leading ? range.endLine + 1 : range.startLine - 1;
        const column = leading ? 1 : model.getLineMaxColumn(line);
        markers.set(`${line}:${leading}`, range.startLine);
        return {
          range: new monaco.Range(line, column, line, column),
          options: {
            description: MARKER,
            showIfCollapsed: true,
            hoverMessage: { value: "Klicken, um einzublenden" },
            [leading ? "before" : "after"]: {
              content: `⋯ ${count} ${count === 1 ? "Zeile" : "Zeilen"} ausgeblendet`,
              inlineClassName: leading ? `${MARKER} ${LEADING}` : MARKER,
              inlineClassNameAffectsLetterSpacing: true,
              cursorStops: monaco.editor.InjectedTextCursorStops.None,
            },
          },
        };
      }),
    );
    for (const line of cursors) revealAt(line);
  };
  const cursor = editor.onDidChangeCursorPosition((event) => revealAt(event.position.lineNumber));
  const click = editor.onMouseDown((event) => {
    const element = event.target.element;
    const line = event.target.position?.lineNumber;
    if (!line || !event.event.leftButton || !element?.classList.contains(MARKER)) return;
    const start = markers.get(`${line}:${element.classList.contains(LEADING)}`);
    if (start === undefined) return;
    event.event.preventDefault();
    onReveal(start);
  });
  return {
    set,
    dispose: () => {
      click.dispose();
      cursor.dispose();
      if (editor.getModel()) set([]);
    },
  };
}

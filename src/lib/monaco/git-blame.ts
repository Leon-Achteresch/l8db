import * as monaco from "monaco-editor/editor/editor.api";
import { blameHover, blameLabel, type FileBlame, mapLines } from "@/lib/versioning/blame";

export function attachGitBlame(
  editor: monaco.editor.IStandaloneCodeEditor,
  blame: FileBlame,
  isNew = false,
): monaco.IDisposable {
  const decorations = editor.createDecorationsCollection();
  let map: (number | null)[] | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const render = () => {
    const model = editor.getModel();
    if (!model) return;
    map ??= mapLines(blame.text, model.getValue());
    const lines = new Set((editor.getSelections() ?? []).map((s) => s.positionLineNumber));
    const now = Date.now();
    decorations.set(
      [...lines].map((line) => {
        const index = map?.[line - 1];
        const commit = index == null ? null : (blame.lines[index] ?? null);
        const column = model.getLineMaxColumn(line);
        return {
          range: new monaco.Range(line, column, line, column),
          options: {
            description: "git-blame",
            showIfCollapsed: true,
            hoverMessage: { value: blameHover(commit, blame.path, now) },
            after: {
              content: `${isNew ? "Neu · " : ""}${blameLabel(commit, now)}`,
              inlineClassName: "git-blame-annotation",
              cursorStops: monaco.editor.InjectedTextCursorStops.None,
            },
          },
        };
      }),
    );
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(render, 80);
  };

  const subscriptions = [
    editor.onDidChangeCursorSelection(schedule),
    editor.onDidChangeModelContent(() => {
      map = null;
      decorations.clear();
      schedule();
    }),
    editor.onDidChangeModel(() => {
      map = null;
      schedule();
    }),
  ];
  render();

  return {
    dispose() {
      clearTimeout(timer);
      for (const subscription of subscriptions) subscription.dispose();
      decorations.clear();
    },
  };
}

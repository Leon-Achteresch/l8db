import * as monaco from "monaco-editor/editor/editor.api";
import { selectionRangesWithoutIndent } from "./selection-ranges";

monaco.editor.onDidCreateEditor((editor) => {
  const decorations = editor.createDecorationsCollection();
  const update = () => {
    const model = editor.getModel();
    const selections = editor.getSelections();
    if (!model || !selections) return decorations.clear();
    decorations.set(
      selectionRangesWithoutIndent(model, selections, editor.getVisibleRanges()).map((range) => ({
        range,
        options: { className: "l8db-selection" },
      })),
    );
  };
  editor.onDidChangeCursorSelection(update);
  editor.onDidChangeModel(update);
  editor.onDidScrollChange((event) => {
    if (event.scrollTopChanged) update();
  });
});

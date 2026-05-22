import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

const globalScope = self as unknown as {
  MonacoEnvironment?: monaco.Environment;
};

globalScope.MonacoEnvironment = {
  getWorker() {
    return new EditorWorker();
  },
};

const transparent = "#00000000";

monaco.editor.defineTheme("l8db-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": transparent,
    "editor.lineHighlightBackground": transparent,
    "editor.lineHighlightBorder": transparent,
    "editorGutter.background": transparent,
    "editorOverviewRuler.background": transparent,
    "scrollbarSlider.background": "#64748b40",
  },
});

monaco.editor.defineTheme("l8db-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": transparent,
    "editor.lineHighlightBackground": transparent,
    "editor.lineHighlightBorder": transparent,
    "editorGutter.background": transparent,
    "editorOverviewRuler.background": transparent,
    "scrollbarSlider.background": "#94a3b840",
  },
});

export { monaco };

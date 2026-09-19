import * as monaco from "monaco-editor/editor/editor.api";

const transparent = "#00000000";

monaco.editor.defineTheme("l8db-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": transparent,
    "editor.lineHighlightBackground": "#64748b0c",
    "editor.lineHighlightBorder": transparent,
    "editorGutter.background": transparent,
    "editorOverviewRuler.background": transparent,
    "scrollbarSlider.background": "#64748b40",
    "editorStickyScroll.background": "#f4f5f7",
    "editorStickyScrollGutter.background": "#f4f5f7",
    "editorStickyScroll.border": "#e2e5ea",
    "editorStickyScroll.shadow": "#00000014",
    "editorStickyScrollHover.background": "#eceef1",
    "editorLink.activeForeground": "#2563eb",
  },
});

monaco.editor.defineTheme("l8db-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": transparent,
    "editor.lineHighlightBackground": "#94a3b80c",
    "editor.lineHighlightBorder": transparent,
    "editorGutter.background": transparent,
    "editorOverviewRuler.background": transparent,
    "scrollbarSlider.background": "#94a3b840",
    "editorStickyScroll.background": "#1d1f2a",
    "editorStickyScrollGutter.background": "#1d1f2a",
    "editorStickyScroll.border": "#2e3345",
    "editorStickyScroll.shadow": "#00000066",
    "editorStickyScrollHover.background": "#262a3a",
    "editorLink.activeForeground": "#60a5fa",
  },
});

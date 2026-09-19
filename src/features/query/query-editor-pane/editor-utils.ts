import { monaco, overflowWidgetsDomNode } from "@/lib/monaco";
import { lintUnknownTables } from "@/lib/sql-lint";

import type { SchemaRegistry } from "./types";

const VIEW_STATE_KEY = "l8db.editor-view-state";

export function readViewStates(): Record<string, monaco.editor.ICodeEditorViewState> {
  try {
    return JSON.parse(localStorage.getItem(VIEW_STATE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function writeViewState(key: string, state: monaco.editor.ICodeEditorViewState | null) {
  const all = readViewStates();
  if (state) all[key] = state;
  else delete all[key];
  try {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(all));
  } catch {}
}

export function themeFor(resolved: string | undefined): string {
  return resolved === "dark" ? "l8db-dark" : "l8db-light";
}

export function refreshLintMarkers(
  editor: monaco.editor.IStandaloneCodeEditor,
  registry: SchemaRegistry,
) {
  const model = editor.getModel();
  if (!model) return;
  const findings =
    model.getLanguageId() === "sql" ? lintUnknownTables(model.getValue(), registry.tables) : [];
  monaco.editor.setModelMarkers(
    model,
    "l8db-sql-lint",
    findings.map((finding) => {
      const start = model.getPositionAt(finding.offset);
      const end = model.getPositionAt(finding.offset + finding.length);
      return {
        severity: monaco.MarkerSeverity.Warning,
        message: finding.message,
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      };
    }),
  );
}

export const STATIC_EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  glyphMargin: true,
  folding: true,
  lineDecorationsWidth: 10,
  lineNumbersMinChars: 3,
  scrollBeyondLastLine: false,
  padding: { top: 16, bottom: 16 },
  renderLineHighlight: "line",
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
  scrollbar: {
    vertical: "auto",
    horizontal: "auto",
    useShadows: false,
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
  },
  fixedOverflowWidgets: true,
  overflowWidgetsDomNode,
};

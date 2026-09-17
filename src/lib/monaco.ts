import "monaco-editor/features/register.all";
import "monaco-editor/editor/contrib/suggest/browser/suggestController";
import "monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/languages/definitions/sql/register";
import {
  conf as sqlConf,
  language as sqlLanguage,
} from "monaco-editor/languages/definitions/sql/sql";
import "monaco-editor/language/json/monaco.contribution";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import { toast } from "sonner";
import { useConnectionsStore } from "@/lib/connections";
import type { DatabaseKind } from "@/lib/db";
import { capabilitiesFor } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";
import { lintPlsql, type SqlMarker, sqlErrorMarkers } from "@/lib/sql-diagnostics";
import {
  formatSqlWith,
  type SqlDialect,
  type SqlFormatOptions,
  sqlDialectForKind,
  supportsSqlFormatting,
} from "@/lib/sql-format";

const globalScope = self as unknown as {
  MonacoEnvironment?: monaco.Environment;
};

globalScope.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    return label === "json" ? new JsonWorker() : new EditorWorker();
  },
};

window.dispatchEvent(new Event("l8db:monaco-ready"));

const plsqlKeywords = [
  "BODY",
  "BULK",
  "COLLECT",
  "CONSTANT",
  "CURSOR",
  "DETERMINISTIC",
  "ELSIF",
  "EXCEPTION",
  "EXIT",
  "FORALL",
  "FUNCTION",
  "IMMUTABLE",
  "LANGUAGE",
  "LOOP",
  "NOTICE",
  "OUT",
  "PACKAGE",
  "PARALLEL_ENABLE",
  "PIPELINED",
  "PRAGMA",
  "PROCEDURE",
  "RAISE",
  "RECORD",
  "REF",
  "RETURN",
  "RETURNS",
  "REVERSE",
  "ROWTYPE",
  "SQLCODE",
  "SQLERRM",
  "STABLE",
  "STRICT",
  "TYPE",
  "VARRAY",
  "PLPGSQL",
  "PERFORM",
  "SLICE",
];

monaco.editor.addKeybindingRules([
  { keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, command: "editor.action.gotoLine" },
  { keybinding: monaco.KeyMod.WinCtrl | monaco.KeyCode.LeftArrow, command: "cursorWordLeft" },
  { keybinding: monaco.KeyMod.WinCtrl | monaco.KeyCode.RightArrow, command: "cursorWordRight" },
  {
    keybinding: monaco.KeyMod.WinCtrl | monaco.KeyMod.Shift | monaco.KeyCode.LeftArrow,
    command: "cursorWordLeftSelect",
  },
  {
    keybinding: monaco.KeyMod.WinCtrl | monaco.KeyMod.Shift | monaco.KeyCode.RightArrow,
    command: "cursorWordRightSelect",
  },
]);

monaco.languages.register({ id: "plsql" });
monaco.languages.setLanguageConfiguration("plsql", sqlConf);
monaco.languages.setMonarchTokensProvider("plsql", {
  ...sqlLanguage,
  keywords: [...sqlLanguage.keywords, ...plsqlKeywords],
});

monaco.languages.register({ id: "redis" });
monaco.languages.setLanguageConfiguration("redis", {
  comments: { lineComment: "#" },
  brackets: [],
  autoClosingPairs: [
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
});
monaco.languages.setMonarchTokensProvider("redis", {
  tokenizer: {
    root: [
      [/^\s*#.*/, "comment"],
      [/^\s*[A-Za-z][A-Za-z0-9_.]*/, "keyword"],
      [/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/, "string"],
      [/\b\d+\b/, "number"],
    ],
  },
});

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

export function activeConnectionKind(): DatabaseKind | null {
  const { connections, activeId } = useConnectionsStore.getState();
  return connections.find((connection) => connection.id === activeId)?.kind ?? null;
}

export function activeSqlDialect(): SqlDialect {
  return sqlDialectForKind(activeConnectionKind());
}

export function isSqlFormattingAvailable(): boolean {
  const kind = activeConnectionKind();
  if (!kind) return true;
  return supportsSqlFormatting(capabilitiesFor(kind).query_language);
}

function currentFormatOptions(dialect?: SqlDialect): SqlFormatOptions {
  const {
    editorTabSize,
    editorKeywordCase,
    editorFormatLinesBetweenQueries,
    editorFormatDenseOperators,
    editorFormatNewlineBeforeSemicolon,
  } = useSettingsStore.getState();
  return {
    dialect: dialect ?? activeSqlDialect(),
    tabWidth: editorTabSize ?? 2,
    keywordCase: editorKeywordCase ?? "upper",
    linesBetweenQueries: editorFormatLinesBetweenQueries ?? 2,
    denseOperators: editorFormatDenseOperators ?? false,
    newlineBeforeSemicolon: editorFormatNewlineBeforeSemicolon ?? false,
  };
}

export function formatSql(sql: string, dialect?: SqlDialect): string {
  const result = formatSqlWith(sql, currentFormatOptions(dialect));
  if (!result.ok) throw new Error(result.reason);
  return result.sql;
}

function reportFormatError(reason: string): void {
  toast.error("SQL-Formatierung fehlgeschlagen", { description: reason });
}

for (const lang of ["sql", "plsql"]) {
  monaco.languages.registerDocumentFormattingEditProvider(lang, {
    provideDocumentFormattingEdits(model) {
      if (!isSqlFormattingAvailable()) return [];
      const result = formatSqlWith(model.getValue(), currentFormatOptions());
      if (!result.ok) {
        reportFormatError(result.reason);
        return [];
      }
      return [{ range: model.getFullModelRange(), text: result.sql }];
    },
  });

  monaco.languages.registerDocumentRangeFormattingEditProvider(lang, {
    provideDocumentRangeFormattingEdits(model, range) {
      if (!isSqlFormattingAvailable()) return [];
      const result = formatSqlWith(model.getValueInRange(range), currentFormatOptions());
      if (!result.ok) {
        reportFormatError(result.reason);
        return [];
      }
      return [{ range, text: result.sql }];
    },
  });
}

export function addSqlFormatAction(
  editor: monaco.editor.IStandaloneCodeEditor,
): monaco.IDisposable {
  const available = editor.createContextKey<boolean>(
    "l8dbSqlFormattable",
    isSqlFormattingAvailable(),
  );
  const unsubscribe = useConnectionsStore.subscribe(() => {
    available.set(isSqlFormattingAvailable());
  });
  const action = editor.addAction({
    id: "l8db.format-sql",
    label: "SQL-Syntax formatieren",
    precondition: "l8dbSqlFormattable",
    keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
    contextMenuGroupId: "1_modification",
    contextMenuOrder: 1.5,
    run(ed) {
      const selection = ed.getSelection();
      const action =
        selection && !selection.isEmpty()
          ? "editor.action.formatSelection"
          : "editor.action.formatDocument";
      void ed.getAction(action)?.run();
    },
  });
  return {
    dispose() {
      unsubscribe();
      action.dispose();
    },
  };
}

function setSqlMarkers(model: monaco.editor.ITextModel, owner: string, markers: SqlMarker[]) {
  const length = model.getValueLength();
  monaco.editor.setModelMarkers(
    model,
    owner,
    markers
      .filter((marker) => marker.start >= 0 && marker.start <= length)
      .map((marker) => {
        const start = model.getPositionAt(marker.start);
        const end = model.getPositionAt(Math.max(marker.end, marker.start + 1));
        return {
          severity:
            marker.severity === "error"
              ? monaco.MarkerSeverity.Error
              : monaco.MarkerSeverity.Warning,
          message: marker.message,
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        };
      }),
  );
}

export interface SqlErrorSource {
  message: string;
  text?: string;
  base?: number;
}

export function showSqlError(
  editor: monaco.editor.IStandaloneCodeEditor,
  error: SqlErrorSource | null,
): void {
  const model = editor.getModel();
  if (!model) return;
  const markers = error
    ? sqlErrorMarkers(
        error.message,
        error.text ?? model.getValue(),
        error.base ?? 0,
        activeConnectionKind(),
      )
    : [];
  setSqlMarkers(model, "l8db-sql-error", markers);
  const first = markers.find((marker) => marker.start >= 0);
  if (first) editor.revealPositionInCenterIfOutsideViewport(model.getPositionAt(first.start));
}

export function attachPlsqlLint(editor: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let kind = activeConnectionKind();
  const run = () => {
    const model = editor.getModel();
    if (!model) return;
    const enabled = kind === "oracle" && ["sql", "plsql"].includes(model.getLanguageId());
    setSqlMarkers(model, "l8db-plsql-lint", enabled ? lintPlsql(model.getValue()) : []);
  };
  run();
  const changeSub = editor.onDidChangeModelContent(() => {
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  });
  const unsubscribe = useConnectionsStore.subscribe(() => {
    const next = activeConnectionKind();
    if (next === kind) return;
    kind = next;
    run();
  });
  return {
    dispose() {
      clearTimeout(timer);
      changeSub.dispose();
      unsubscribe();
    },
  };
}

export { monaco };

export const overflowWidgetsDomNode: HTMLElement = (() => {
  const node = document.createElement("div");
  node.className = "monaco-editor";
  document.body.appendChild(node);
  return node;
})();

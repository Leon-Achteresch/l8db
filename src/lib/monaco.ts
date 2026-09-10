import * as monaco from "monaco-editor";
import {
  conf as sqlConf,
  language as sqlLanguage,
} from "monaco-editor/esm/vs/basic-languages/sql/sql";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { format } from "sql-formatter";

const globalScope = self as unknown as {
  MonacoEnvironment?: monaco.Environment;
};

globalScope.MonacoEnvironment = {
  getWorker() {
    return new EditorWorker();
  },
};

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

monaco.languages.register({ id: "plsql" });
monaco.languages.setLanguageConfiguration("plsql", sqlConf);
monaco.languages.setMonarchTokensProvider("plsql", {
  ...sqlLanguage,
  keywords: [...sqlLanguage.keywords, ...plsqlKeywords],
});

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

export function formatSql(sql: string): string {
  return format(sql, {
    language: "postgresql",
    tabWidth: 2,
    keywordCase: "upper",
    linesBetweenQueries: 2,
  });
}

for (const lang of ["sql", "plsql"]) {
  monaco.languages.registerDocumentFormattingEditProvider(lang, {
    provideDocumentFormattingEdits(model) {
      try {
        return [
          {
            range: model.getFullModelRange(),
            text: formatSql(model.getValue()),
          },
        ];
      } catch {
        return [];
      }
    },
  });

  monaco.languages.registerDocumentRangeFormattingEditProvider(lang, {
    provideDocumentRangeFormattingEdits(model, range) {
      try {
        return [
          {
            range,
            text: formatSql(model.getValueInRange(range)),
          },
        ];
      } catch {
        return [];
      }
    },
  });
}

export function addSqlFormatAction(
  editor: monaco.editor.IStandaloneCodeEditor,
): monaco.IDisposable {
  return editor.addAction({
    id: "l8db.format-sql",
    label: "SQL-Syntax formatieren",
    keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
    contextMenuGroupId: "1_modification",
    contextMenuOrder: 1.5,
    run(ed) {
      void ed.getAction("editor.action.formatDocument")?.run();
    },
  });
}

export { monaco };

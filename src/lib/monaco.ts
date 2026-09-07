import "monaco-editor/esm/vs/editor/edcore.main";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import {
  conf as sqlConf,
  language as sqlLanguage,
} from "monaco-editor/esm/vs/basic-languages/sql/sql";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { toast } from "sonner";
import { useConnectionsStore } from "@/lib/connections";
import type { DatabaseKind } from "@/lib/db";
import { capabilitiesFor } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";
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

function activeConnectionKind(): DatabaseKind | null {
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
  const { editorTabSize, editorKeywordCase } = useSettingsStore.getState();
  return {
    dialect: dialect ?? activeSqlDialect(),
    tabWidth: editorTabSize ?? 2,
    keywordCase: editorKeywordCase ?? "upper",
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

export { monaco };

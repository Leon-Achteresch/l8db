import * as monaco from "monaco-editor/editor/editor.api";
import { toast } from "sonner";
import { useConnectionsStore } from "@/lib/connections";
import type { DatabaseKind } from "@/lib/db";
import { capabilitiesFor } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";
import { plsqlBlockPairs } from "@/lib/sql-diagnostics";
import {
  formatSqlWith,
  type SqlDialect,
  type SqlFormatOptions,
  sqlDialectForKind,
  supportsSqlFormatting,
} from "@/lib/sql-format";

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

for (const lang of ["sql", "plsql"]) {
  monaco.languages.registerDefinitionProvider(lang, {
    provideDefinition(model, position) {
      const offset = model.getOffsetAt(position);
      const pair = plsqlBlockPairs(model.getValue()).find(
        (p) => p.close.start <= offset && offset <= p.close.end,
      );
      if (!pair) return null;
      const toRange = (span: { start: number; end: number }) =>
        monaco.Range.fromPositions(model.getPositionAt(span.start), model.getPositionAt(span.end));
      return {
        uri: model.uri,
        range: toRange(pair.open),
        originSelectionRange: toRange(pair.close),
      };
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

import * as monaco from "monaco-editor/editor/editor.api";
import { toast } from "sonner";
import { useConnectionsStore } from "@/lib/connections";
import type { DatabaseKind } from "@/lib/db";
import { capabilitiesFor } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";
import { plsqlBlockPairs } from "@/lib/sql-diagnostics";
import type { SqlFormatResult } from "@/lib/sql-format";
import {
  type SqlDialect,
  type SqlFormatOptions,
  sqlDialectForKind,
  supportsSqlFormatting,
} from "@/lib/sql-format-options";
import { formatSqlInWorker } from "@/lib/sql-format-runner";
import { splitSqlStatements, statementAtOffset } from "@/lib/sql-statements";

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

function reportFormatError(reason: string): void {
  toast.error("SQL-Formatierung fehlgeschlagen", { description: reason });
}

const pastedRanges = new WeakMap<monaco.editor.ITextModel, monaco.IRange>();

async function formatRange(
  model: monaco.editor.ITextModel,
  range: monaco.IRange,
  token: monaco.CancellationToken,
  silent: boolean,
): Promise<monaco.languages.TextEdit[]> {
  if (!isSqlFormattingAvailable()) return [];
  const version = model.getVersionId();
  const text = model.getValueInRange(range);
  const fail = (reason: string) => {
    if (!silent && !token.isCancellationRequested) reportFormatError(reason);
    return [];
  };
  if (splitSqlStatements(text, activeConnectionKind() ?? undefined).unterminated)
    return fail("Nicht abgeschlossenes Literal oder Kommentar.");
  let result: SqlFormatResult;
  try {
    result = await formatSqlInWorker(text, currentFormatOptions());
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (token.isCancellationRequested || model.isDisposed() || model.getVersionId() !== version)
    return [];
  if (!result.ok) return fail(result.reason);
  return result.sql === text ? [] : [{ range, text: result.sql }];
}

for (const lang of ["sql", "plsql"]) {
  monaco.languages.registerDocumentFormattingEditProvider(lang, {
    provideDocumentFormattingEdits: (model, _options, token) =>
      formatRange(model, model.getFullModelRange(), token, false),
  });

  monaco.languages.registerDocumentRangeFormattingEditProvider(lang, {
    provideDocumentRangeFormattingEdits(model, range, _options, token) {
      const pasted = pastedRanges.get(model);
      pastedRanges.delete(model);
      return formatRange(
        model,
        range,
        token,
        pasted !== undefined && monaco.Range.equalsRange(pasted, range),
      );
    },
  });

  monaco.languages.registerOnTypeFormattingEditProvider(lang, {
    autoFormatTriggerCharacters: [";"],
    provideOnTypeFormattingEdits(model, position, _ch, _options, token) {
      const offset = model.getOffsetAt(position);
      const statement = statementAtOffset(
        model.getValue(),
        offset - 1,
        activeConnectionKind() ?? undefined,
      );
      if (!statement || statement.end !== offset) return [];
      const range = monaco.Range.fromPositions(
        model.getPositionAt(statement.start),
        model.getPositionAt(statement.end),
      );
      return formatRange(model, range, token, true);
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
  const paste = editor.onDidPaste(({ range }) => {
    const model = editor.getModel();
    if (model) pastedRanges.set(model, range);
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
      paste.dispose();
      action.dispose();
    },
  };
}

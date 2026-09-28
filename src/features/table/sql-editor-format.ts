import type { EditorView } from "@codemirror/view";
import { toast } from "sonner";
import { useConnectionsStore } from "@/lib/connections";
import { useSettingsStore } from "@/lib/settings";
import { sqlDialectForKind } from "@/lib/sql-format-options";
import { formatSqlInWorker } from "@/lib/sql-format-runner";

export async function formatEditorSql(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const source = view.state.doc.toString();
  const selection = from !== to;
  const text = selection ? source.slice(from, to) : source;
  const { connections, activeId } = useConnectionsStore.getState();
  const kind = connections.find((connection) => connection.id === activeId)?.kind ?? null;
  const settings = useSettingsStore.getState();
  try {
    const result = await formatSqlInWorker(text, {
      dialect: sqlDialectForKind(kind),
      tabWidth: settings.editorTabSize,
      keywordCase: settings.editorKeywordCase,
      linesBetweenQueries: settings.editorFormatLinesBetweenQueries,
      denseOperators: settings.editorFormatDenseOperators,
      newlineBeforeSemicolon: settings.editorFormatNewlineBeforeSemicolon,
    });
    if (!view.dom.isConnected || view.state.doc.toString() !== source) return;
    if (!result.ok) {
      toast.error("SQL-Formatierung fehlgeschlagen", { description: result.reason });
      return;
    }
    view.dispatch({
      changes: {
        from: selection ? from : 0,
        to: selection ? to : source.length,
        insert: result.sql,
      },
    });
  } catch (error) {
    toast.error("SQL-Formatierung fehlgeschlagen", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

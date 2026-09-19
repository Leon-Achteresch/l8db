import * as monaco from "monaco-editor/editor/editor.api";
import { useConnectionsStore } from "@/lib/connections";
import {
  impactCallMarkers,
  lintPlsql,
  type SqlMarker,
  sqlErrorMarkers,
} from "@/lib/sql-diagnostics";
import { activeConnectionKind } from "./format";

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
  const source = error?.text ?? model.getValue();
  const markers = error
    ? [
        ...sqlErrorMarkers(error.message, source, error.base ?? 0, activeConnectionKind()),
        ...impactCallMarkers(error.message, source).map((marker) => ({
          ...marker,
          start: marker.start + (error.base ?? 0),
          end: marker.end + (error.base ?? 0),
        })),
      ]
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

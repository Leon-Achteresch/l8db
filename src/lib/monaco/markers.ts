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

const ASSESSMENT_SEVERITY = {
  optimal: monaco.MarkerSeverity.Info,
  improvable: monaco.MarkerSeverity.Warning,
  poor: monaco.MarkerSeverity.Error,
} as const;

export function showQueryAssessment(
  editor: monaco.editor.IStandaloneCodeEditor,
  sql: string,
  assessment: unknown,
): boolean {
  const model = editor.getModel();
  if (!model) return false;
  if (
    typeof assessment !== "object" ||
    assessment === null ||
    !("verdict" in assessment) ||
    !("message" in assessment) ||
    typeof assessment.verdict !== "string" ||
    !Object.hasOwn(ASSESSMENT_SEVERITY, assessment.verdict) ||
    typeof assessment.message !== "string"
  ) {
    monaco.editor.setModelMarkers(model, "l8db-query-assessment", []);
    return false;
  }
  const target = sql.trim();
  const found = target ? model.getValue().indexOf(target) : -1;
  if (found < 0) {
    monaco.editor.setModelMarkers(model, "l8db-query-assessment", []);
    return false;
  }
  const start = model.getPositionAt(found);
  const end = model.getPositionAt(found + target.length);
  monaco.editor.setModelMarkers(model, "l8db-query-assessment", [
    {
      severity: ASSESSMENT_SEVERITY[assessment.verdict as keyof typeof ASSESSMENT_SEVERITY],
      message: assessment.message,
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    },
  ]);
  editor.revealLineInCenterIfOutsideViewport(start.lineNumber);
  return true;
}

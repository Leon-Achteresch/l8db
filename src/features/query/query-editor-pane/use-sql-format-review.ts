import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";
import { useConnectionsStore } from "@/lib/connections";
import { monaco } from "@/lib/monaco";
import {
  activeConnectionKind,
  currentFormatOptions,
  formatEditorSql,
  isSqlFormattingAvailable,
} from "@/lib/monaco/format";
import type { SqlDialect } from "@/lib/sql-format-options";

export type SqlFormatReview = { dialect: SqlDialect; selection: boolean } & (
  | { status: "loading" | "unchanged" | "stale" }
  | { status: "error"; message: string }
  | { status: "ready"; original: string; formatted: string }
);

interface FormatReviewRequest {
  dispose: () => void;
  current: () => boolean;
  apply: (formatted: string) => void;
  invalidate: () => void;
}

export function useSqlFormatReview(
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  editorKey: string | undefined,
  language: string,
) {
  const [review, setReview] = useState<SqlFormatReview | null>(null);
  const active = useRef<FormatReviewRequest | null>(null);
  const scope = useRef<{ editorKey?: string; language: string } | null>(null);

  const dispose = useCallback(() => {
    active.current?.dispose();
    active.current = null;
  }, []);

  useLayoutEffect(() => {
    scope.current = { editorKey, language };
    setReview(null);
    return () => {
      scope.current = null;
      dispose();
    };
  }, [editorKey, language, dispose]);

  const close = () => {
    dispose();
    setReview(null);
  };

  const open = () => {
    const origin = scope.current;
    if (review || active.current || origin?.language !== "sql" || !isSqlFormattingAvailable())
      return;
    const editor = editorRef.current;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    if (!editor || !model || !selection || editor.getOption(monaco.editor.EditorOption.readOnly))
      return;

    const kind = activeConnectionKind();
    const connectionId = useConnectionsStore.getState().activeId;
    const options = currentFormatOptions();
    const meta = { dialect: options.dialect, selection: !selection.isEmpty() };
    if (editor.getSelections()?.length !== 1) {
      setReview({
        ...meta,
        status: "error",
        message: "Wähle einen zusammenhängenden SQL-Bereich.",
      });
      return;
    }
    const version = model.getVersionId();
    const range = meta.selection ? selection : model.getFullModelRange();
    const original = model.getValueInRange(range);
    const controller = new AbortController();
    const subscriptions: monaco.IDisposable[] = [];
    const current = () => {
      const nextSelection = editor.getSelection();
      return (
        scope.current === origin &&
        editorRef.current === editor &&
        !model.isDisposed() &&
        editor.getModel() === model &&
        model.getVersionId() === version &&
        editor.getSelections()?.length === 1 &&
        Boolean(nextSelection && monaco.Selection.selectionsEqual(selection, nextSelection)) &&
        useConnectionsStore.getState().activeId === connectionId &&
        activeConnectionKind() === kind &&
        !editor.getOption(monaco.editor.EditorOption.readOnly)
      );
    };
    const invalidate = () => {
      if (active.current !== request) return;
      dispose();
      setReview({ ...meta, status: "stale" });
    };
    const request: FormatReviewRequest = {
      current,
      invalidate,
      dispose: () => {
        for (const subscription of subscriptions) subscription.dispose();
        controller.abort();
      },
      apply: (formatted) => {
        editor.pushUndoStop();
        editor.executeEdits(REVIEW_EDIT_SOURCE, [
          { range, text: formatted, forceMoveMarkers: true },
        ]);
        editor.pushUndoStop();
      },
    };
    active.current = request;
    subscriptions.push(
      editor.onDidChangeModelContent(invalidate),
      editor.onDidChangeModel(invalidate),
      editor.onDidChangeModelLanguage(invalidate),
      editor.onDidDispose(invalidate),
      editor.onDidChangeCursorSelection(() => {
        if (!current()) invalidate();
      }),
      {
        dispose: useConnectionsStore.subscribe(() => {
          if (!current()) invalidate();
        }),
      },
    );
    setReview({ ...meta, status: "loading" });
    void formatEditorSql(original, kind, options, controller.signal)
      .then((result) => {
        if (active.current !== request) return;
        if (!current()) {
          invalidate();
          return;
        }
        if (!result.ok) {
          dispose();
          setReview({ ...meta, status: "error", message: result.reason });
          return;
        }
        const formatted = result.sql.replace(/\r\n|\r|\n/g, model.getEOL());
        if (formatted === original) {
          dispose();
          setReview({ ...meta, status: "unchanged" });
          return;
        }
        setReview({ ...meta, status: "ready", original, formatted });
      })
      .catch((error: unknown) => {
        if (active.current !== request) return;
        dispose();
        setReview({
          ...meta,
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  const apply = () => {
    const request = active.current;
    if (!request || review?.status !== "ready") return;
    if (!request.current()) {
      request.invalidate();
      return;
    }
    close();
    request.apply(review.formatted);
  };

  return { review, open, close, apply, focus: () => editorRef.current?.focus() };
}

const REVIEW_EDIT_SOURCE = "sql-format-review";

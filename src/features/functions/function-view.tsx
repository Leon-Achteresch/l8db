import { HammerIcon, LoaderIcon, TriangleAlertIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompileObject } from "@/features/functions/use-compile-object";
import {
  OpenInQueryEditorButton,
  SqlEditActions,
  SqlEditFeedback,
  SqlEditHint,
  useSqlObjectEdit,
} from "@/features/functions/use-sql-object-edit";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities } from "@/lib/db-selection";
import { buildInvalidSet, isFunctionInvalid } from "@/lib/invalid-objects";
import { addSqlFormatAction, monaco } from "@/lib/monaco";
import { attachSqlIntellisense } from "@/lib/monaco-intellisense";
import { useFunctionDefinitionQuery, useInvalidObjectsQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";

function themeFor(resolved: string | undefined): string {
  return resolved === "dark" ? "l8db-dark" : "l8db-light";
}

export interface FunctionViewProps {
  schema: string;
  name: string;
  oid?: string;
  line?: number;
}

export function FunctionView({ schema, name, oid, line }: FunctionViewProps) {
  const connection = useActiveConnection();
  const openFunctionTab = useTableTabs((state) => state.openFunctionTab);
  const capabilities = useActiveCapabilities();
  const { compile, state: compileState } = useCompileObject();
  const { data, isLoading, isError, error } = useFunctionDefinitionQuery(oid ?? "");
  const { data: invalidObjects } = useInvalidObjectsQuery();
  const invalidSet = useMemo(() => buildInvalidSet(invalidObjects), [invalidObjects]);
  const isInvalid = isFunctionInvalid(invalidSet, schema, name);
  const edit = useSqlObjectEdit(`${schema}.${name}`, data ?? "");

  useEffect(() => {
    if (oid) {
      openFunctionTab({ schema, name, oid });
    }
  }, [schema, name, oid, openFunctionTab]);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-hidden bg-background p-4 space-y-3 select-none">
        <Skeleton className="h-6 w-64 bg-muted/50" />
        <div className="space-y-2 mt-4">
          {Array.from({ length: 15 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-5 bg-muted/30"
              style={{ width: `${60 + Math.random() * 30}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <div className="flex flex-col items-center gap-3 max-w-md text-center p-6 rounded-lg border border-destructive/20 bg-destructive/5 shadow-xs">
          <TriangleAlertIcon className="size-8 text-destructive animate-bounce" />
          <h3 className="text-sm font-semibold text-destructive">Fehler beim Laden der Funktion</h3>
          <p className="text-xs text-muted-foreground font-mono bg-destructive/[0.02] p-2.5 rounded border border-destructive/10 break-all select-text">
            {String(error)}
          </p>
        </div>
      </div>
    );
  }

  const compileResult = compileState.status === "done" ? compileState.result : null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground flex-1">
          {schema}.{name}
        </span>
        {isInvalid && !compileResult ? <Badge variant="destructive">INVALID</Badge> : null}
        {!edit.editing && capabilities.compile_objects && oid ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() => void compile(oid, "function", `${schema}.${name}`)}
            disabled={compileState.status === "loading"}
            title="Kompiliert das gespeicherte Objekt in der Datenbank neu — ohne den Quelltext zu ändern."
          >
            {compileState.status === "loading" ? (
              <LoaderIcon data-icon="inline-start" className="animate-spin" />
            ) : (
              <HammerIcon data-icon="inline-start" />
            )}
            Kompilieren
          </Button>
        ) : null}
        <OpenInQueryEditorButton sql={data ?? ""} title={`${schema}.${name}`} />
        <SqlEditActions edit={edit} />
      </div>

      {edit.editing ? <SqlEditHint /> : null}

      <SqlEditorPane
        value={edit.editing ? edit.sql : (data ?? "")}
        readOnly={!edit.editing}
        onChange={edit.editing ? edit.setSql : undefined}
        revealLine={compileResult?.line ?? line}
      />

      {compileResult && compileResult.status !== "VALID" ? (
        <div className="flex flex-col gap-1 border-t bg-destructive/5 px-4 py-2.5">
          <span className="text-xs font-semibold text-destructive">
            Kompilierfehler
            {compileResult.line ? ` in Zeile ${compileResult.line}` : ""}
            {compileResult.position ? `, Position ${compileResult.position}` : ""}
          </span>
          <pre className="whitespace-pre-wrap break-all text-xs font-mono text-destructive select-text">
            {compileResult.message}
          </pre>
        </div>
      ) : null}

      <SqlEditFeedback state={edit.state} />
    </div>
  );
}

interface SqlEditorPaneProps {
  value: string;
  readOnly: boolean;
  onChange?: (value: string) => void;
  revealLine?: number;
}

export function SqlEditorPane({ value, readOnly, onChange, revealLine }: SqlEditorPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const { resolvedTheme } = useTheme();

  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.create(container, {
      value,
      language: "plsql",
      theme: themeFor(resolvedTheme),
      readOnly,
      domReadOnly: readOnly,
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: "on",
      glyphMargin: false,
      folding: true,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontSize: 13,
      lineHeight: 24,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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
      tabSize: 2,
    });

    editorRef.current = editor;

    const changeSub = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(editor.getValue());
    });

    const formatAction = addSqlFormatAction(editor);
    const intellisense = attachSqlIntellisense(editor);

    return () => {
      changeSub.dispose();
      formatAction.dispose();
      intellisense.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({ readOnly, domReadOnly: readOnly });
  }, [readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      editor.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(themeFor(resolvedTheme));
  }, [resolvedTheme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !revealLine) return;
    editor.revealLineInCenter(revealLine);
    editor.setPosition({ lineNumber: revealLine, column: 1 });
    const decorations = editor.createDecorationsCollection();
    const range = new monaco.Range(revealLine, 1, revealLine, 1);
    const timers = [0, 1, 2].flatMap((i) => [
      setTimeout(
        () =>
          decorations.set([{ range, options: { isWholeLine: true, className: "sql-flash-line" } }]),
        i * 400,
      ),
      setTimeout(() => decorations.clear(), i * 400 + 200),
    ]);
    return () => {
      timers.forEach(clearTimeout);
      decorations.clear();
    };
  }, [revealLine, value]);

  return <div ref={containerRef} className="size-full min-h-0 flex-1" />;
}

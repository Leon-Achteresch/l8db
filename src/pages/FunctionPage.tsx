import { useEffect, useRef } from "react";

import { getRouteApi } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { TriangleAlertIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { useActiveConnection } from "@/lib/connections";
import { monaco } from "@/lib/monaco";
import { useFunctionDefinitionQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";

const routeApi = getRouteApi("/_app/functions/$schema/$name");

function themeFor(resolved: string | undefined): string {
  return resolved === "dark" ? "l8db-dark" : "l8db-light";
}

export function FunctionPage() {
  const { schema, name } = routeApi.useParams();
  const { oid } = routeApi.useSearch();
  const connection = useActiveConnection();
  const openFunctionTab = useTableTabs((state) => state.openFunctionTab);
  const { data, isLoading, isError, error } = useFunctionDefinitionQuery(oid);

  useEffect(() => {
    if (oid) {
      openFunctionTab({ schema, name, oid });
    }
  }, [schema, name, oid, openFunctionTab]);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">
          Keine Verbindung aktiv.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-hidden bg-background p-4 space-y-3 select-none">
        <Skeleton className="h-6 w-64 bg-muted/50" />
        <div className="space-y-2 mt-4">
          {Array.from({ length: 15 }).map((_, i) => (
            <Skeleton key={i} className="h-5 bg-muted/30" style={{ width: `${60 + Math.random() * 30}%` }} />
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
          <h3 className="text-sm font-semibold text-destructive">
            Fehler beim Laden der Funktion
          </h3>
          <p className="text-xs text-muted-foreground font-mono bg-destructive/[0.02] p-2.5 rounded border border-destructive/10 break-all select-text">
            {String(error)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {schema}.{name}
        </span>
      </div>
      <ReadOnlySqlEditor value={data ?? ""} />
    </div>
  );
}

function ReadOnlySqlEditor({ value }: { value: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.create(container, {
      value,
      language: "sql",
      theme: themeFor(resolvedTheme),
      readOnly: true,
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
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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
      domReadOnly: true,
    });

    editorRef.current = editor;

    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      editor.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(themeFor(resolvedTheme));
  }, [resolvedTheme]);

  return <div ref={containerRef} className="size-full min-h-0 flex-1" />;
}

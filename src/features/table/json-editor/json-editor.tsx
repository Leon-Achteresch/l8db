import { Loader2Icon } from "lucide-react";
import { lazy, Suspense, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { getAt, type JsonPath, sortKeysDeep, stringifyJson, tableShape } from "@/lib/json-editor";
import { cn } from "@/lib/utils";
import { pickBytesFromFile, saveBytesToFile } from "@/lib/value-viewers/binary-file";
import { JsonStatusBar } from "./json-status-bar";
import { JsonTableView } from "./json-table-view";
import { JsonToolbar } from "./json-toolbar";
import { JsonTree } from "./json-tree";
import { useJsonEditor } from "./use-json-editor";

const JsonCodeEditor = lazy(() => import("./json-code-editor"));

type Props = {
  text: string;
  onChange?: (text: string) => void;
  readOnly: boolean;
  columnName: string;
  className?: string;
};

export function JsonEditor({ text, onChange, readOnly, columnName, className }: Props) {
  const state = useJsonEditor({ text, onChange, readOnly, columnName });
  const searchRef = useRef<HTMLInputElement>(null);
  const feature = useNewFeatureVisibility<HTMLDivElement>("table.cell.json-editor");
  const { doc, selectedPath, parsed, mode } = state;

  const table = useMemo(() => {
    for (let length = selectedPath.length; length >= 0; length--) {
      const path = selectedPath.slice(0, length);
      const value = getAt(doc, path);
      if (tableShape(value)) return { path, value };
    }
    return null;
  }, [doc, selectedPath]);

  const format = () => parsed.ok && state.commit(stringifyJson(doc, 2));
  const minify = () => parsed.ok && state.commit(JSON.stringify(doc));
  const sortAll = () => parsed.ok && state.commitDoc(sortKeysDeep(doc));

  const saveFile = async () => {
    try {
      const name = `${columnName.replace(/[^\w.-]+/g, "_") || "wert"}.json`;
      if (await saveBytesToFile(new TextEncoder().encode(text), name))
        toast.success("JSON gespeichert");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const loadFile = async () => {
    try {
      const file = await pickBytesFromFile();
      if (!file) return;
      const content = new TextDecoder().decode(file.bytes);
      try {
        state.commit(stringifyJson(JSON.parse(content), 2));
      } catch {
        state.commit(content);
        state.setMode("code");
        toast.warning("Datei enthält kein gültiges JSON");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const pickFromTable = (path: JsonPath) => {
    state.reveal(path);
    state.setMode("tree");
  };

  const effectiveMode = !parsed.ok ? "code" : mode === "table" && !table ? "tree" : mode;

  return (
    <div
      ref={feature.ref}
      className={cn(
        "flex h-[min(62vh,640px)] min-h-80 flex-col overflow-hidden rounded-xl border border-border/80 bg-muted/25 shadow-inner",
        className,
      )}
      data-testid="json-editor"
      onKeyDown={(event) => {
        const mod = event.metaKey || event.ctrlKey;
        if (!mod) return;
        const inMonaco = (event.target as HTMLElement).closest(".monaco-editor");
        const inInput = (event.target as HTMLElement).tagName === "INPUT";
        const key = event.key.toLowerCase();
        if (key === "f" && event.shiftKey) {
          event.preventDefault();
          format();
        } else if (key === "f" && effectiveMode === "tree") {
          event.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
        } else if (key === "z" && !inMonaco && !inInput) {
          event.preventDefault();
          if (event.shiftKey) state.redo();
          else state.undo();
        }
      }}
    >
      <JsonToolbar
        state={{ ...state, mode: effectiveMode }}
        readOnly={readOnly}
        tableAvailable={!!table}
        isNew={feature.isNew}
        searchRef={searchRef}
        onFormat={format}
        onMinify={minify}
        onSortAll={sortAll}
        onSaveFile={() => void saveFile()}
        onLoadFile={() => void loadFile()}
      />
      <div className="relative min-h-0 flex-1">
        {effectiveMode === "code" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
              </div>
            }
          >
            <JsonCodeEditor
              value={text}
              readOnly={readOnly}
              onChange={(next) => state.commit(next, "code")}
            />
          </Suspense>
        ) : effectiveMode === "table" && table ? (
          <JsonTableView value={table.value} basePath={table.path} onPick={pickFromTable} />
        ) : (
          <JsonTree state={state} readOnly={readOnly} />
        )}
      </div>
      <JsonStatusBar state={state} />
    </div>
  );
}

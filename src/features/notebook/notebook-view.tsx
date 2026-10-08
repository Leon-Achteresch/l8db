import { useEffect, useMemo, useRef, useState } from "react";
import { PanelErrorBoundary } from "@/components/error-boundary/panel-error-boundary";
import { Button } from "@/components/ui/button";
import { useActiveConnection } from "@/lib/connections";
import {
  type NotebookCell,
  type NotebookCellType,
  notebookPages,
  useNotebookLayout,
  useNotebookStore,
} from "@/lib/notebook";
import { saveNotebook } from "@/lib/notebook/actions";
import { MarkdownCell } from "./markdown-cell";
import { NotebookAddCell } from "./notebook-add-cell";
import { NotebookBook } from "./notebook-book";
import { NotebookCellFrame } from "./notebook-cell-frame";
import { NotebookToolbar } from "./notebook-toolbar";
import { SqlCell } from "./sql-cell";
import { useNotebookRunner } from "./use-notebook-runner";
import { VariablesCell } from "./variables-cell";

const PAGE_KEYS: Record<string, 1 | -1> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

export function NotebookView() {
  const active = useActiveConnection();
  const doc = useNotebookStore((s) => s.doc);
  const cells = doc.cells;
  const defaultConnection = doc.connectionId ?? active?.id ?? null;
  const outputs = useNotebookStore((s) => s.outputs);
  const running = useNotebookStore((s) => s.running);
  const restored = useNotebookStore((s) => s.restored);
  const store = useNotebookStore.getState;
  const runner = useNotebookRunner();
  const busy = Object.keys(running).length > 0;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const book = useNotebookLayout((s) => s.layout) === "book";
  const [target, setTarget] = useState<{ index: number } | null>(null);

  const counters = useMemo(() => {
    const order = Object.entries(outputs)
      .sort(([, a], [, b]) => a.ranAt - b.ranAt)
      .map(([id]) => id);
    return new Map(order.map((id, index) => [id, index + 1]));
  }, [outputs]);

  useEffect(() => {
    if (!focusId) return;
    if (book) {
      const pages = notebookPages(useNotebookStore.getState().doc.cells);
      setTarget({ index: pages.findIndex((page) => page.some((c) => c.id === focusId)) });
    }
    scrollRef.current
      ?.querySelector(`[data-cell-id="${focusId}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setFocusId(null);
  }, [focusId, book]);

  const add = (type: NotebookCellType, index: number, pageBreak?: boolean) =>
    setFocusId(store().addCell(type, index, pageBreak));
  const update = (id: string, next: (cell: NotebookCell) => NotebookCell) =>
    store().updateCell(id, next);
  const duplicate = (cell: NotebookCell, index: number) => {
    const id = store().addCell(cell.type, index + 1);
    update(id, () => ({ ...structuredClone(cell), id, pageBreak: undefined }));
    setFocusId(id);
  };
  const jumpPage = (direction: 1 | -1) => {
    const root = scrollRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top;
    const starts = [
      0,
      ...[...root.querySelectorAll<HTMLElement>("[data-page-start]")].map(
        (element) => element.getBoundingClientRect().top - top + root.scrollTop - 12,
      ),
    ];
    const current = root.scrollTop;
    const next =
      direction > 0
        ? starts.find((start) => start > current + 4)
        : [...starts].reverse().find((start) => start < current - 4);
    if (next !== undefined) root.scrollTo({ top: next, behavior: "smooth" });
  };

  const renderCell = (cell: NotebookCell) => {
    const index = cells.indexOf(cell);
    return (
      <NotebookCellFrame
        key={cell.id}
        id={cell.id}
        type={cell.type}
        counter={
          cell.type === "sql"
            ? running[cell.id]
              ? "[*]"
              : counters.has(cell.id)
                ? `[${counters.get(cell.id)}]`
                : "[ ]"
            : null
        }
        first={index === 0}
        last={index === cells.length - 1}
        pageBreak={Boolean(cell.pageBreak)}
        divider={!book}
        run={
          cell.type === "sql"
            ? {
                running: Boolean(running[cell.id]),
                onRun: () => void runner.runCell(cell.id),
                onRunFrom: () => void runner.runFrom(cell.id),
                onCancel: runner.cancel,
              }
            : undefined
        }
        onTogglePageBreak={() => update(cell.id, (c) => ({ ...c, pageBreak: !c.pageBreak }))}
        onMove={(delta) => {
          store().moveCell(cell.id, delta);
          setFocusId(cell.id);
        }}
        onDuplicate={() => duplicate(cell, index)}
        onRemove={() => store().removeCell(cell.id)}
        onAdd={(type) => add(type, index + 1)}
      >
        <PanelErrorBoundary
          label="Die Zelle"
          source="notebook-cell"
          resetKeys={[cell, outputs[cell.id]]}
        >
          {cell.type === "markdown" ? (
            <MarkdownCell
              source={cell.source}
              onChange={(source) =>
                update(cell.id, (c) => (c.type === "markdown" ? { ...c, source } : c))
              }
            />
          ) : cell.type === "variables" ? (
            <VariablesCell
              variables={cell.variables}
              onChange={(variables) =>
                update(cell.id, (c) => (c.type === "variables" ? { ...c, variables } : c))
              }
            />
          ) : (
            <SqlCell
              cell={cell}
              connectionId={defaultConnection}
              output={outputs[cell.id]}
              running={Boolean(running[cell.id])}
              onRun={() => void runner.runCell(cell.id)}
              onRunAll={() => {
                if (!busy) void runner.runAll();
              }}
              onCancel={runner.cancel}
            />
          )}
        </PanelErrorBoundary>
      </NotebookCellFrame>
    );
  };

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col"
      onKeyDown={(event) => {
        const mod = event.metaKey || event.ctrlKey;
        if (mod && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void saveNotebook(event.shiftKey);
        } else if (mod && event.shiftKey && event.key === "Enter") {
          event.preventDefault();
          if (!busy) void runner.runAll();
        } else if (!book && event.altKey && PAGE_KEYS[event.key]) {
          if ((event.target as HTMLElement).closest(".monaco-editor, textarea, input")) return;
          event.preventDefault();
          jumpPage(PAGE_KEYS[event.key]);
        }
      }}
    >
      <NotebookToolbar
        running={busy}
        onRunAll={() => void runner.runAll()}
        onCancel={runner.cancel}
      />
      {restored && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-400">
          Ungespeicherter Entwurf aus der letzten Sitzung wiederhergestellt.
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 text-xs"
            onClick={() => store().dismissRestored()}
          >
            Ausblenden
          </Button>
        </div>
      )}
      {book ? (
        <div className="min-h-0 flex-1 bg-muted/40">
          <NotebookBook
            target={target}
            pages={[
              ...notebookPages(cells).map((page) => (
                <div key={page[0].id} className="flex flex-col gap-2">
                  {page.map(renderCell)}
                </div>
              )),
              <div key="new" className="flex h-full flex-col items-center justify-center gap-2">
                <p className="text-sm text-muted-foreground">
                  {cells.length === 0 ? "Das Notebook ist leer." : "Neue Seite"}
                </p>
                <NotebookAddCell onAdd={(type) => add(type, cells.length, cells.length > 0)} />
              </div>,
            ]}
          />
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[64rem] flex-col px-6 pt-5 pb-16">
            <input
              aria-label="Notebook-Name"
              className="ml-12 rounded-md bg-transparent px-1 text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground hover:bg-muted/50 focus-visible:bg-muted/50"
              placeholder="Unbenanntes Notebook"
              value={doc.name}
              onChange={(event) => store().patchDoc({ name: event.target.value })}
            />
            <NotebookAddCell onAdd={(type) => add(type, 0)} compact={cells.length > 0} />
            {cells.map(renderCell)}
            {cells.length === 0 ? (
              <p className="mt-6 ml-12 text-sm text-muted-foreground">Das Notebook ist leer.</p>
            ) : (
              <div className="mt-2">
                <NotebookAddCell onAdd={(type) => add(type, cells.length, false)} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { PanelErrorBoundary } from "@/components/error-boundary/panel-error-boundary";
import { Button } from "@/components/ui/button";
import { useActiveConnection } from "@/lib/connections";
import {
  type NotebookCell,
  type NotebookCellType,
  notebookPages,
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

export function NotebookView() {
  const active = useActiveConnection();
  const cells = useNotebookStore((s) => s.doc.cells);
  const defaultConnection = useNotebookStore((s) => s.doc.connectionId) ?? active?.id ?? null;
  const outputs = useNotebookStore((s) => s.outputs);
  const running = useNotebookStore((s) => s.running);
  const restored = useNotebookStore((s) => s.restored);
  const store = useNotebookStore.getState;
  const runner = useNotebookRunner();
  const busy = Object.keys(running).length > 0;

  const [target, setTarget] = useState<{ index: number } | null>(null);
  const reveal = (id: string) =>
    setTarget({
      index: notebookPages(store().doc.cells).findIndex((page) => page.some((c) => c.id === id)),
    });
  const add = (type: NotebookCellType, index: number, pageBreak?: boolean) =>
    reveal(store().addCell(type, index, pageBreak));
  const update = (id: string, next: (cell: NotebookCell) => NotebookCell) =>
    store().updateCell(id, next);

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void saveNotebook(event.shiftKey);
        }
      }}
    >
      <NotebookToolbar
        running={busy}
        onRunAll={() => void runner.runAll()}
        onCancel={runner.cancel}
      />
      {restored && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
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
      <div className="min-h-0 flex-1 bg-muted/40">
        <NotebookBook
          target={target}
          pages={[
            ...notebookPages(cells).map((page) => (
              <div key={page[0].id} className="flex flex-col gap-4">
                {page.map((cell) => {
                  const index = cells.indexOf(cell);
                  return (
                    <NotebookCellFrame
                      key={cell.id}
                      type={cell.type}
                      first={index === 0}
                      last={index === cells.length - 1}
                      pageBreak={Boolean(cell.pageBreak)}
                      onTogglePageBreak={() => {
                        update(cell.id, (c) => ({ ...c, pageBreak: !c.pageBreak }));
                        reveal(cell.id);
                      }}
                      onMove={(delta) => {
                        store().moveCell(cell.id, delta);
                        reveal(cell.id);
                      }}
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
                              update(cell.id, (c) =>
                                c.type === "variables" ? { ...c, variables } : c,
                              )
                            }
                          />
                        ) : (
                          <SqlCell
                            cell={cell}
                            connectionId={defaultConnection}
                            output={outputs[cell.id]}
                            running={Boolean(running[cell.id])}
                            onRun={() => void runner.runCell(cell.id)}
                            onRunFrom={() => void runner.runFrom(cell.id)}
                            onCancel={runner.cancel}
                          />
                        )}
                      </PanelErrorBoundary>
                    </NotebookCellFrame>
                  );
                })}
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
    </div>
  );
}

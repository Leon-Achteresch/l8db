import { Button } from "@/components/ui/button";
import { useActiveConnection } from "@/lib/connections";
import { type NotebookCell, type NotebookCellType, useNotebookStore } from "@/lib/notebook";
import { saveNotebook } from "@/lib/notebook/actions";
import { MarkdownCell } from "./markdown-cell";
import { NotebookAddCell } from "./notebook-add-cell";
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

  const add = (type: NotebookCellType, index: number) => store().addCell(type, index);
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
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto grid max-w-5xl gap-1 px-4 py-4">
          {cells.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Das Notebook ist leer. Füge eine Zelle hinzu.
            </p>
          )}
          <NotebookAddCell onAdd={(type) => add(type, 0)} compact={cells.length > 0} />
          {cells.map((cell, index) => (
            <NotebookCellFrame
              key={cell.id}
              type={cell.type}
              first={index === 0}
              last={index === cells.length - 1}
              onMove={(delta) => store().moveCell(cell.id, delta)}
              onRemove={() => store().removeCell(cell.id)}
              onAdd={(type) => add(type, index + 1)}
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
                  onRunFrom={() => void runner.runFrom(cell.id)}
                  onCancel={runner.cancel}
                />
              )}
            </NotebookCellFrame>
          ))}
        </div>
      </div>
    </div>
  );
}

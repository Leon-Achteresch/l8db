import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { CellValueDialog } from "@/features/table/cell-value-dialog";
import {
  type ArrayEditorContext,
  readArrayEditorFixture,
  updateArrayEditorCell,
} from "@/lib/db/array-editor-development";

const columns = ["items", "nums", "empty_items", "null_items"];

export function ArrayEditorDevelopment({ context }: { context: ArrayEditorContext }) {
  const [snapshot, setSnapshot] = useState(context.snapshot);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const row = snapshot.data.rows[0];
  const save = async (value: string | null) => {
    if (!selected || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    let written = false;
    try {
      await updateArrayEditorCell(context.token, String(row.__ctid__), selected, value);
      written = true;
      setSelected(null);
      setSnapshot(await readArrayEditorFixture());
    } catch (failure) {
      setStale(written);
      const message = written ? `Gespeichert; Readback fehlt: ${String(failure)}` : String(failure);
      setError(message);
      toast.error(message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const refresh = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      setSnapshot(await readArrayEditorFixture());
      setStale(false);
      setError(null);
    } catch (failure) {
      setError(String(failure));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6 text-sm">
      <h1 className="text-lg font-semibold">Array Editor · isolierte Entwicklung</h1>
      <p className="text-muted-foreground">Eigene PostgreSQL-Fixture · direkter Zellschreibweg</p>
      <div className="flex flex-wrap gap-2">
        {columns.map((column) => (
          <Button
            key={column}
            variant="outline"
            disabled={busy || stale}
            onClick={() => setSelected(column)}
          >
            {column}
          </Button>
        ))}
      </div>
      <section
        aria-label="PostgreSQL-Readback"
        className="overflow-auto rounded bg-muted/40 p-4 font-mono text-xs"
      >
        <pre>{JSON.stringify(snapshot, null, 2)}</pre>
      </section>
      {error && <p role="alert">{error}</p>}
      <Button disabled={busy} variant="outline" onClick={() => void refresh()}>
        Neu lesen
      </Button>
      {selected && (
        <CellValueDialog
          key={selected}
          columnName={selected}
          dataType={context.columns.find((column) => column.name === selected)?.data_type}
          value={row[selected]}
          canEdit={true}
          isSaving={busy}
          onSave={save}
          onClose={() => !saving.current && setSelected(null)}
        />
      )}
      <Toaster />
    </main>
  );
}

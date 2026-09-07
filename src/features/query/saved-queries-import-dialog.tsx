import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { AlertTriangle, CopyPlus, FileJson } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useSavedQueriesStore } from "@/lib/saved-queries";
import {
  parseSavedQueryImport,
  resolveSavedQueryImport,
  type SavedQueryDuplicateStrategy,
  type SavedQueryImportCandidate,
} from "@/lib/saved-queries-transfer";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SavedQueriesImportDialog({ open, onOpenChange }: Props) {
  const [candidates, setCandidates] = useState<SavedQueryImportCandidate[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<number | null>(null);
  const [strategy, setStrategy] = useState<SavedQueryDuplicateStrategy>("skip");
  const [busy, setBusy] = useState(false);

  const invalid = candidates?.filter((candidate) => candidate.error) ?? [];
  const duplicates = candidates?.filter((candidate) => candidate.duplicateOf) ?? [];
  const importable = candidates
    ? resolveSavedQueryImport(
        candidates,
        selected,
        strategy,
        useSavedQueriesStore.getState().queries,
      ).length
    : 0;

  function reset() {
    setCandidates(null);
    setFileName("");
    setError(null);
    setSelected(new Set());
    setExpanded(null);
  }

  function close(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function toggle(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function pickFile() {
    setBusy(true);
    try {
      const picked = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!picked || typeof picked !== "string") return;
      const text = await readTextFile(picked);
      const parsed = parseSavedQueryImport(text, useSavedQueriesStore.getState().queries);
      setFileName(picked.split(/[/\\]/).pop() ?? picked);
      setError(parsed.error);
      setCandidates(parsed.error ? null : parsed.candidates);
      setExpanded(null);
      setSelected(
        new Set(
          parsed.candidates
            .filter((candidate) => !candidate.error)
            .map((candidate) => candidate.index),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function runImport() {
    if (!candidates) return;
    const store = useSavedQueriesStore.getState();
    const resolved = resolveSavedQueryImport(candidates, selected, strategy, store.queries);
    if (resolved.length === 0) {
      toast.info("Keine Queries importiert.");
      return;
    }
    store.importQueries(resolved);
    toast.success(
      resolved.length === 1 ? "1 Query importiert" : `${resolved.length} Queries importiert`,
    );
    close(false);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Gespeicherte Queries importieren</DialogTitle>
          <DialogDescription>
            Der Import führt nichts aus. Jeder Eintrag lässt sich vor der Übernahme einsehen.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={pickFile} disabled={busy}>
            <FileJson className="size-4" />
            Datei wählen
          </Button>
          {fileName && <span className="truncate text-xs text-muted-foreground">{fileName}</span>}
        </div>

        {error && (
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </p>
        )}

        {candidates && candidates.length > 0 && (
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {candidates.map((candidate) => (
              <div key={candidate.index} className="rounded-md px-1 py-1 hover:bg-muted/40">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selected.has(candidate.index)}
                    disabled={Boolean(candidate.error)}
                    onCheckedChange={() => toggle(candidate.index)}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    disabled={Boolean(candidate.error)}
                    onClick={() =>
                      setExpanded(expanded === candidate.index ? null : candidate.index)
                    }
                  >
                    <span className="block truncate text-sm">{candidate.label}</span>
                    {candidate.error ? (
                      <span className="text-[11px] text-destructive">{candidate.error}</span>
                    ) : candidate.duplicateOf ? (
                      <span className="text-[11px] text-muted-foreground">
                        Name bereits vorhanden
                      </span>
                    ) : null}
                  </button>
                </div>
                {expanded === candidate.index && candidate.query && (
                  <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] whitespace-pre-wrap">
                    {candidate.query.sql}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}

        {duplicates.length > 0 && (
          <div className="rounded-md border p-2">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <CopyPlus className="size-3.5" />
              {duplicates.length} Namenskollision(en)
            </p>
            <RadioGroup
              className="mt-2 gap-1.5"
              value={strategy}
              onValueChange={(value) => setStrategy(value as SavedQueryDuplicateStrategy)}
            >
              <label className="flex items-center gap-2 text-xs">
                <RadioGroupItem value="skip" />
                Überspringen
              </label>
              <label className="flex items-center gap-2 text-xs">
                <RadioGroupItem value="copy" />
                Als Kopie anlegen
              </label>
            </RadioGroup>
          </div>
        )}

        {invalid.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {invalid.length} Eintrag/Einträge sind ungültig und werden nicht importiert.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>
            Abbrechen
          </Button>
          <Button onClick={runImport} disabled={busy || importable === 0}>
            {importable === 1 ? "1 Query importieren" : `${importable} Queries importieren`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

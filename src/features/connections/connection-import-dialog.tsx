import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { AlertTriangle, CopyPlus, FileJson, Rat } from "lucide-react";
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
import {
  type DuplicateStrategy,
  type ImportCandidate,
  parseConnectionImport,
  resolveImport,
} from "@/lib/connection-export";
import { useConnectionsStore } from "@/lib/connections";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectionImportDialog({ open, onOpenChange }: Props) {
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [source, setSource] = useState<"l8db" | "toad">("l8db");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [strategy, setStrategy] = useState<DuplicateStrategy>("skip");
  const [busy, setBusy] = useState(false);

  const invalid = candidates?.filter((candidate) => candidate.error) ?? [];
  const duplicates = candidates?.filter((candidate) => candidate.duplicateOf) ?? [];
  const importable = candidates ? resolveImport(candidates, selected, strategy).length : 0;

  async function pickFile() {
    setBusy(true);
    try {
      const picked = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [
          { name: "l8db oder Toad", extensions: ["json", "xml"] },
          { name: "l8db (JSON)", extensions: ["json"] },
          { name: "Toad for Oracle (XML)", extensions: ["xml"] },
        ],
      });
      if (!picked || typeof picked !== "string") return;
      const text = await readTextFile(picked);
      const parsed = parseConnectionImport(text, useConnectionsStore.getState().connections);
      setFileName(picked.split("/").pop() ?? picked);
      setSource(parsed.source);
      setError(parsed.error);
      setCandidates(parsed.error ? null : parsed.candidates);
      setSelected(
        new Set(
          parsed.candidates
            .filter((candidate) => !candidate.error)
            .map((candidate) => candidate.index),
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setCandidates(null);
    } finally {
      setBusy(false);
    }
  }

  function toggle(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function confirm() {
    if (!candidates) return;
    const resolved = resolveImport(candidates, selected, strategy);
    if (resolved.length === 0) {
      toast.info("Keine Verbindungen übernommen.");
      onOpenChange(false);
      return;
    }
    useConnectionsStore.getState().addImported(resolved);
    toast.success(
      resolved.length === 1
        ? "1 Verbindung importiert. Passwörter bitte im Profil ergänzen."
        : `${resolved.length} Verbindungen importiert. Passwörter bitte in den Profilen ergänzen.`,
    );
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Verbindungen importieren</DialogTitle>
          <DialogDescription>
            Exportdatei aus l8db (JSON) oder Toad for Oracle (XML) auswählen. Bestehende Profile
            bleiben unverändert, es wird keine Verbindung aufgebaut. Passwörter werden nach dem
            Import regulär im Profil erfasst.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void pickFile()} disabled={busy}>
              <FileJson className="size-4" />
              Datei wählen
            </Button>
            {fileName && (
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                {source === "toad" ? (
                  <Rat className="size-3.5 shrink-0" aria-label="Toad for Oracle" />
                ) : (
                  <FileJson className="size-3.5 shrink-0" aria-label="l8db" />
                )}
                <span className="truncate font-mono">{fileName}</span>
              </span>
            )}
          </div>
          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </p>
          )}
          {candidates && candidates.length === 0 && (
            <p className="text-xs text-muted-foreground">Die Datei enthält keine Verbindungen.</p>
          )}
          {candidates && candidates.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-md border">
              {candidates.map((candidate) => (
                <label
                  key={candidate.index}
                  className={`flex items-start gap-2 border-b px-2 py-2 text-sm last:border-b-0 ${candidate.error ? "opacity-70" : "cursor-pointer hover:bg-muted"}`}
                >
                  <Checkbox
                    checked={!candidate.error && selected.has(candidate.index)}
                    disabled={Boolean(candidate.error)}
                    onCheckedChange={() => toggle(candidate.index)}
                    aria-label={candidate.label}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{candidate.label}</span>
                    {candidate.error ? (
                      <span className="block text-[11px] text-destructive">
                        Ungültig: {candidate.error}
                      </span>
                    ) : candidate.duplicateOf ? (
                      <span className="block text-[11px] text-amber-600 dark:text-amber-400">
                        Dublette von „{candidate.duplicateOf.name}“
                      </span>
                    ) : (
                      <span className="block text-[11px] text-muted-foreground">
                        {candidate.profile?.kind}
                        {candidate.profile?.ssh ? " · SSH-Tunnel" : ""}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
          {duplicates.length > 0 && (
            <fieldset className="rounded-md border px-3 py-2">
              <legend className="px-1 text-xs font-medium">Dubletten ({duplicates.length})</legend>
              <RadioGroup
                value={strategy}
                onValueChange={(value) => setStrategy(value as DuplicateStrategy)}
                className="gap-1.5"
              >
                <label className="flex items-center gap-2 text-xs">
                  <RadioGroupItem value="skip" id="import-dup-skip" />
                  Überspringen, bestehendes Profil behalten
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <RadioGroupItem value="copy" id="import-dup-copy" />
                  <CopyPlus className="size-3.5" />
                  Als Kopie mit neuer ID übernehmen
                </label>
              </RadioGroup>
            </fieldset>
          )}
          {invalid.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {invalid.length === 1
                ? "1 Eintrag ist ungültig und wird nicht importiert."
                : `${invalid.length} Einträge sind ungültig und werden nicht importiert.`}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={confirm} disabled={busy || !candidates || importable === 0}>
            {importable === 0 ? "Importieren" : `${importable} importieren`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

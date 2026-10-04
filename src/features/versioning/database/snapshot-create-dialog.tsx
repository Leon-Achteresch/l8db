import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isMasked, sourceChoices } from "@/lib/branching/model";
import { branchingSnapshot } from "@/lib/db";
import { VersioningSelect } from "../versioning-select";
import type { BranchingWorkspace } from "./use-branching";

export function SnapshotCreateDialog({
  workspace,
  onClose,
}: {
  workspace: BranchingWorkspace;
  onClose: () => void;
}) {
  const overview = workspace.overview;
  const choices = overview ? sourceChoices(overview.databases) : [];
  const [database, setDatabase] = useState(
    choices.some((entry) => entry.name === workspace.database)
      ? workspace.database
      : (overview?.root ?? ""),
  );
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const selected = choices.find((entry) => entry.name === database);
  const masked = isMasked(selected);
  const ready = Boolean(selected) && !masked && Boolean(overview?.vault.ready);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="vcs-surface sm:max-w-md">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            onClose();
            void workspace.job(
              `Sicherung von „${database}“`,
              (url) => branchingSnapshot(url, { database, label, note }, workspace.toolPaths),
              database,
              () => `Sicherung von „${database}“ erstellt und geprüft.`,
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Sicherung erstellen</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              Ein transaktionskonsistenter Stand wird gelesen, verschlüsselt im Tresor abgelegt und
              signiert. Die Datenbank bleibt währenddessen voll nutzbar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 text-xs">
            <span className="font-medium">Datenbank</span>
            <VersioningSelect
              hideLabel
              label="Datenbank"
              value={database}
              onChange={setDatabase}
              options={choices.map((entry) => ({ value: entry.name, label: entry.name }))}
            />
            {masked && (
              <span className="block text-amber-700 dark:text-amber-300">
                Maskierte Datenbanken werden nicht im Klartext gesichert. Ein anonymisierter Branch
                ist der sichere Weg.
              </span>
            )}
          </div>
          <label className="block space-y-1.5 text-xs">
            <span className="font-medium">Bezeichnung</span>
            <Input
              autoFocus
              value={label}
              maxLength={200}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="z. B. Vor Migration 42"
            />
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="font-medium">Notiz</span>
            <Textarea
              value={note}
              maxLength={4000}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional: Anlass, Ticket, Ansprechpartner"
              className="min-h-16 text-xs"
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" size="sm" disabled={!ready}>
              Sicherung starten
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

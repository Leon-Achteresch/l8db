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
import { Switch } from "@/components/ui/switch";
import { expiryText, hoursFromNow, validBranchName } from "@/lib/branching/model";
import { type BranchingDatabase, type BranchMeta, branchingUpdate } from "@/lib/db";
import { VersioningSelect } from "../versioning-select";
import type { BranchingWorkspace } from "./use-branching";

const EXPIRY_OPTIONS = [
  { value: "keep", label: "Unverändert" },
  { value: "never", label: "Kein Ablauf" },
  { value: "24", label: "In 1 Tag" },
  { value: "168", label: "In 7 Tagen" },
  { value: "720", label: "In 30 Tagen" },
];

export function BranchSettingsDialog({
  workspace,
  database,
  branch,
  onClose,
}: {
  workspace: BranchingWorkspace;
  database: BranchingDatabase;
  branch: BranchMeta;
  onClose: () => void;
}) {
  const [name, setName] = useState(database.name);
  const [locked, setLocked] = useState(branch.protected);
  const [expiry, setExpiry] = useState("keep");
  const [confirm, setConfirm] = useState("");
  const renamed = name !== database.name;
  const nameError = renamed ? validBranchName(name) : null;
  const unlocking = branch.protected && !locked;
  const ready = !nameError && (!unlocking || confirm === database.name) && !(renamed && locked);
  const save = async () => {
    const url = workspace.url();
    const current = branch.expiresAt ?? null;
    const expiresAt =
      expiry === "keep" ? current : expiry === "never" ? null : hoursFromNow(Number(expiry));
    if (locked !== branch.protected || expiresAt !== current)
      await branchingUpdate(url, {
        action: "branch",
        name: database.name,
        protected: locked,
        expiresAt,
        confirm,
      });
    if (renamed) await branchingUpdate(url, { action: "rename", name: database.name, to: name });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="vcs-surface sm:max-w-md">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            void workspace.run(save, "Einstellungen gespeichert.").then((ok) => {
              if (!ok) return;
              if (renamed && workspace.database === database.name) workspace.openDatabase(name);
              onClose();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Branch-Einstellungen</DialogTitle>
            <DialogDescription className="text-xs">
              {database.name} · {expiryText(branch.expiresAt) ?? "kein Ablaufdatum"}
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5 text-xs">
            <span className="font-medium">Name</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value.trim())}
              aria-invalid={Boolean(nameError)}
              className="font-mono"
              disabled={locked}
            />
            {nameError && <span className="text-destructive">{nameError}</span>}
            {locked && (
              <span className="text-muted-foreground">
                Geschützte Branches lassen sich nicht umbenennen.
              </span>
            )}
            {renamed && database.sessions > 0 && (
              <span className="text-amber-700 dark:text-amber-300">
                Umbenennen gelingt nur ohne offene Verbindungen ({database.sessions}).
              </span>
            )}
          </label>
          <div className="space-y-1.5 text-xs">
            <span className="font-medium">Ablauf</span>
            <VersioningSelect
              hideLabel
              label="Ablauf"
              value={expiry}
              onChange={setExpiry}
              options={EXPIRY_OPTIONS}
            />
          </div>
          <label className="flex items-start justify-between gap-4 rounded-lg bg-muted/40 p-3 text-xs">
            <span>
              <span className="font-medium">Geschützt</span>
              <span className="mt-0.5 block text-muted-foreground">
                Kein Löschen, Zurücksetzen oder automatisches Aufräumen ohne Bestätigung.
              </span>
            </span>
            <Switch checked={locked} onCheckedChange={setLocked} aria-label="Branch schützen" />
          </label>
          {unlocking && (
            <label className="block space-y-1.5 text-xs">
              <span className="text-muted-foreground">
                Schutz aufheben: <span className="font-mono text-foreground">{database.name}</span>{" "}
                eingeben
              </span>
              <Input
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className="font-mono"
                aria-label="Name zur Bestätigung"
              />
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" size="sm" disabled={!ready || workspace.busy}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

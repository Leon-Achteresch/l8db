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
import { Textarea } from "@/components/ui/textarea";
import { expiryText, hoursFromNow } from "@/lib/branching/model";
import { branchingLocal, type SnapshotInfo } from "@/lib/db";
import { VersioningSelect } from "../versioning-select";
import type { BranchingWorkspace } from "./use-branching";

const EXPIRY_OPTIONS = [
  { value: "keep", label: "Unverändert" },
  { value: "never", label: "Kein Ablauf" },
  { value: "7", label: "In 7 Tagen" },
  { value: "30", label: "In 30 Tagen" },
  { value: "90", label: "In 90 Tagen" },
  { value: "365", label: "In 1 Jahr" },
];

export function SnapshotEditDialog({
  workspace,
  snapshot,
  onClose,
}: {
  workspace: BranchingWorkspace;
  snapshot: SnapshotInfo;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(snapshot.label);
  const [note, setNote] = useState(snapshot.note);
  const [locked, setLocked] = useState(snapshot.protected);
  const [expiry, setExpiry] = useState("keep");
  const ready = Boolean(label.trim());
  const save = () =>
    branchingLocal({
      action: "snapshot",
      id: snapshot.id,
      label,
      note,
      protected: locked,
      expiresAt:
        expiry === "keep"
          ? snapshot.expiresAt
          : expiry === "never"
            ? null
            : hoursFromNow(Number(expiry) * 24),
    });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="vcs-surface sm:max-w-md">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            void workspace.run(save, "Sicherung aktualisiert.").then((ok) => ok && onClose());
          }}
        >
          <DialogHeader>
            <DialogTitle>Sicherung bearbeiten</DialogTitle>
            <DialogDescription className="text-xs">
              {snapshot.database} · {new Date(snapshot.createdAt).toLocaleString("de-DE")} ·{" "}
              {expiryText(snapshot.expiresAt) ?? "kein Ablaufdatum"}
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5 text-xs">
            <span className="font-medium">Bezeichnung</span>
            <Input
              autoFocus
              value={label}
              maxLength={200}
              onChange={(event) => setLabel(event.target.value)}
              aria-invalid={!ready}
            />
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="font-medium">Notiz</span>
            <Textarea
              value={note}
              maxLength={4000}
              onChange={(event) => setNote(event.target.value)}
              className="min-h-16 text-xs"
            />
          </label>
          <div className="space-y-1.5 text-xs">
            <span className="font-medium">Aufbewahrung</span>
            <VersioningSelect
              hideLabel
              label="Aufbewahrung"
              value={expiry}
              onChange={setExpiry}
              options={EXPIRY_OPTIONS}
            />
          </div>
          <label className="flex items-start justify-between gap-4 rounded-lg bg-muted/40 p-3 text-xs">
            <span>
              <span className="font-medium">Geschützt</span>
              <span className="mt-0.5 block text-muted-foreground">
                Kein Löschen und kein automatisches Aufräumen, auch nicht durch den Zeitplan.
              </span>
            </span>
            <Switch checked={locked} onCheckedChange={setLocked} aria-label="Sicherung schützen" />
          </label>
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

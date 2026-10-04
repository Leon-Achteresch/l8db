import { CircleAlertIcon } from "lucide-react";
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
import { isProtected } from "@/lib/branching/model";
import { branchingRun, type SnapshotInfo } from "@/lib/db";
import { VersioningSelect } from "../versioning-select";
import type { BranchingWorkspace } from "./use-branching";

const KEEP_OPTIONS = [
  { value: "24", label: "1 Tag" },
  { value: "72", label: "3 Tage" },
  { value: "168", label: "7 Tage" },
  { value: "720", label: "30 Tage" },
];

export function RestoreDialog({
  workspace,
  snapshot,
  onClose,
}: {
  workspace: BranchingWorkspace;
  snapshot: SnapshotInfo;
  onClose: () => void;
}) {
  const [keep, setKeep] = useState("168");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const overview = workspace.overview;
  const target = overview?.databases.find((entry) => entry.name === snapshot.database);
  if (!overview || !target) return null;
  const locked = isProtected(target);
  const server = overview.server;
  const foreign = target.sessions - target.ownSessions;
  const problems = [
    !target.isOwner &&
      !server.superuser &&
      `Nur der Eigentümer (${target.owner}) oder ein Superuser kann wiederherstellen.`,
    !server.createDb && !server.superuser && `Die Rolle „${server.user}“ benötigt CREATEDB.`,
    overview.readOnly && "Die Verbindung ist schreibgeschützt.",
  ].filter((entry): entry is string => Boolean(entry));
  const ready =
    !problems.length && (!locked || (confirm === target.name && Boolean(reason.trim())));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="vcs-surface sm:max-w-lg">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            onClose();
            void workspace.job(
              `„${target.name}“ wiederherstellen`,
              (url) =>
                branchingRun(
                  url,
                  {
                    action: "restore",
                    database: target.name,
                    snapshot: snapshot.id,
                    keepHours: Number(keep),
                    confirm,
                    reason,
                  },
                  workspace.toolPaths,
                ),
              target.name,
              (job) =>
                `„${target.name}“ wiederhergestellt. Der bisherige Stand liegt in „${String(job.result?.previous ?? "")}“.`,
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>„{target.name}“ wiederherstellen?</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              Stand „{snapshot.label}“ vom{" "}
              {new Date(snapshot.createdAt).toLocaleString("de-DE", {
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              · {snapshot.tables} Tabellen · {snapshot.rows.toLocaleString("de-DE")} Zeilen
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-2 rounded-lg bg-muted/40 p-3 text-xs leading-relaxed">
            <li>
              <span className="font-medium">1. Daneben aufbauen.</span>{" "}
              <span className="text-muted-foreground">
                Die Sicherung wird entschlüsselt, geprüft und in eine neue Zwischenstufe
                eingespielt. „{target.name}“ läuft währenddessen unverändert weiter.
              </span>
            </li>
            <li>
              <span className="font-medium">2. Abgleichen.</span>{" "}
              <span className="text-muted-foreground">
                Zeilenzahlen, Eigentümer, Rechte und Datenbankeinstellungen werden geprüft und
                übernommen. Jede Abweichung bricht ab, ohne etwas zu verändern.
              </span>
            </li>
            <li>
              <span className="font-medium">3. Tauschen.</span>{" "}
              <span className="text-muted-foreground">
                Offene Verbindungen werden getrennt, die Namen in einer Transaktion getauscht. Der
                Name bleibt gleich, der bisherige Stand bleibt als eigene Datenbank erhalten.
              </span>
            </li>
          </ol>
          {target.sessions > 0 && (
            <p className="flex gap-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              {target.sessions} offene Verbindungen werden beim Tausch getrennt.
              {foreign > 0 &&
                !server.superuser &&
                !server.signalBackend &&
                " Für Verbindungen anderer Rollen fehlt das Recht pg_signal_backend; der Tausch bricht dann ohne Änderung ab."}
            </p>
          )}
          {problems.map((problem) => (
            <p key={problem} className="flex gap-2 text-xs text-destructive">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              {problem}
            </p>
          ))}
          <div className="space-y-1.5 text-xs">
            <span className="font-medium">Bisherigen Stand aufbewahren</span>
            <VersioningSelect
              hideLabel
              label="Bisherigen Stand aufbewahren"
              value={keep}
              onChange={setKeep}
              options={KEEP_OPTIONS}
            />
          </div>
          <label className="block space-y-1.5 text-xs">
            <span className="font-medium">Änderungsgrund{locked ? "" : " (optional)"}</span>
            <Textarea
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="z. B. Rücknahme der fehlerhaften Migration, Ticket OPS-1234"
              className="min-h-14 text-xs"
            />
          </label>
          {locked && (
            <label className="block space-y-1.5 text-xs">
              <span className="text-muted-foreground">
                Geschützte Datenbank: zur Bestätigung{" "}
                <span className="font-mono text-foreground">{target.name}</span> eingeben
              </span>
              <Input
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                aria-label="Name zur Bestätigung"
                className="font-mono"
              />
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" size="sm" variant="destructive" disabled={!ready}>
              Wiederherstellen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

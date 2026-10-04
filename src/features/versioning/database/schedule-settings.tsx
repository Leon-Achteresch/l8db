import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { isMasked, relativeTime } from "@/lib/branching/model";
import { branchingLocal, type SnapshotSchedule } from "@/lib/db";
import { VersioningSelect } from "../versioning-select";
import type { BranchingWorkspace } from "./use-branching";

const EVERY = [
  { value: "1", label: "Stündlich" },
  { value: "6", label: "Alle 6 Stunden" },
  { value: "12", label: "Alle 12 Stunden" },
  { value: "24", label: "Täglich" },
  { value: "168", label: "Wöchentlich" },
];

const KEEP = [
  { value: "7", label: "Letzte 7" },
  { value: "14", label: "Letzte 14" },
  { value: "30", label: "Letzte 30" },
  { value: "90", label: "Letzte 90" },
  { value: "0", label: "Alle" },
];

const BRANCH_TTL = [
  { value: "", label: "Kein Ablauf" },
  { value: "24", label: "1 Tag" },
  { value: "72", label: "3 Tage" },
  { value: "168", label: "7 Tage" },
  { value: "720", label: "30 Tage" },
];

const SNAPSHOT_TTL = [
  { value: "", label: "Kein Ablauf" },
  { value: "7", label: "7 Tage" },
  { value: "30", label: "30 Tage" },
  { value: "90", label: "90 Tage" },
  { value: "365", label: "1 Jahr" },
];

function withCurrent(options: { value: string; label: string }[], value: string, unit: string) {
  return !value || options.some((option) => option.value === value)
    ? options
    : [...options, { value, label: `${value} ${unit}` }];
}

export function ScheduleSettings({ workspace }: { workspace: BranchingWorkspace }) {
  const overview = workspace.overview;
  const policy = overview?.policy;
  const [enabled, setEnabled] = useState(Boolean(policy?.schedule));
  const [every, setEvery] = useState(String(policy?.schedule?.everyHours ?? 24));
  const [keep, setKeep] = useState(String(policy?.schedule?.keep ?? 14));
  const [branchTtl, setBranchTtl] = useState(String(policy?.branchTtlHours ?? ""));
  const [snapshotTtl, setSnapshotTtl] = useState(String(policy?.snapshotTtlDays ?? ""));
  if (!overview || !policy) return null;
  const root = overview.databases.find((entry) => entry.name === overview.root);
  const masked = isMasked(root);
  const current = policy.schedule;
  const schedule: SnapshotSchedule | null = enabled
    ? {
        everyHours: Number(every),
        keep: Number(keep),
        connectionId: workspace.connection.id,
        lastRunAt: current?.lastRunAt ?? null,
        lastError: current?.lastError ?? null,
      }
    : null;
  const dirty =
    enabled !== Boolean(current) ||
    (enabled &&
      (current?.everyHours !== Number(every) ||
        current?.keep !== Number(keep) ||
        current?.connectionId !== workspace.connection.id)) ||
    branchTtl !== String(policy.branchTtlHours ?? "") ||
    snapshotTtl !== String(policy.snapshotTtlDays ?? "");
  const save = () =>
    void workspace.run(
      () =>
        branchingLocal({
          action: "policy",
          key: overview.policyKey,
          policy: {
            ...policy,
            schedule,
            branchTtlHours: branchTtl ? Number(branchTtl) : null,
            snapshotTtlDays: snapshotTtl ? Number(snapshotTtl) : null,
          },
        }),
      "Richtlinie gespeichert.",
    );
  return (
    <div className="space-y-3">
      <label className="flex items-start justify-between gap-4 rounded-xl bg-muted/40 p-3 text-xs">
        <span>
          <span className="font-medium">Automatisch sichern</span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
            {masked
              ? "Maskierte Datenbanken werden nicht im Klartext gesichert."
              : `Läuft, solange l8db geöffnet ist, über die Verbindung „${workspace.connection.name}“. Ältere automatische Sicherungen werden entfernt, geschützte bleiben.`}
          </span>
          {current?.lastRunAt && (
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Zuletzt {relativeTime(current.lastRunAt)}
            </span>
          )}
          {current?.lastError && (
            <span className="mt-1 block text-[11px] text-destructive">{current.lastError}</span>
          )}
        </span>
        <Switch
          checked={enabled}
          disabled={masked && !enabled}
          onCheckedChange={setEnabled}
          aria-label="Automatisch sichern"
        />
      </label>
      {enabled && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 text-xs">
            <span className="font-medium">Intervall</span>
            <VersioningSelect
              hideLabel
              label="Intervall"
              value={every}
              onChange={setEvery}
              options={withCurrent(EVERY, every, "Stunden")}
            />
          </div>
          <div className="space-y-1.5 text-xs">
            <span className="font-medium">Behalten</span>
            <VersioningSelect
              hideLabel
              label="Behalten"
              value={keep}
              onChange={setKeep}
              options={withCurrent(KEEP, keep, "Sicherungen")}
            />
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5 text-xs">
          <span className="font-medium">Neue Branches laufen ab nach</span>
          <VersioningSelect
            hideLabel
            label="Ablauf neuer Branches"
            value={branchTtl}
            onChange={setBranchTtl}
            options={withCurrent(BRANCH_TTL, branchTtl, "Stunden")}
          />
        </div>
        <div className="space-y-1.5 text-xs">
          <span className="font-medium">Neue Sicherungen laufen ab nach</span>
          <VersioningSelect
            hideLabel
            label="Ablauf neuer Sicherungen"
            value={snapshotTtl}
            onChange={setSnapshotTtl}
            options={withCurrent(SNAPSHOT_TTL, snapshotTtl, "Tage")}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={!dirty || workspace.busy}
          onClick={save}
        >
          Speichern
        </Button>
      </div>
    </div>
  );
}

import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { AlignmentDraft } from "@/lib/versioning/align";
import type { DatabaseRelease, DatabaseTarget } from "@/lib/versioning/types";
import { VersioningSelect } from "./versioning-select";

export function VersioningAlign({
  target,
  releases,
  busy,
  onPreview,
  onSave,
  onFinish,
  onClose,
}: {
  target: DatabaseTarget;
  releases: DatabaseRelease[];
  busy: boolean;
  onPreview: (standard: string, allowDrops: boolean) => Promise<AlignmentDraft>;
  onSave: (draft: AlignmentDraft) => void;
  onFinish: (standard: string) => void;
  onClose: () => void;
}) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("versioning.targets.align");
  const main = releases.filter((release) => (release.track ?? "main") === "main");
  const [standard, setStandard] = useState(main.at(-1)?.id ?? "");
  const [allowDrops, setAllowDrops] = useState(false);
  const [draft, setDraft] = useState<AlignmentDraft | null>(null);
  return (
    <div
      ref={feature.ref}
      role="dialog"
      aria-label="Auf Standard angleichen"
      className="flex flex-col gap-3 rounded-lg bg-muted/30 p-4 text-xs"
    >
      <h2 className="flex items-center gap-2 font-semibold">
        {target.name}: zurück auf die Standardlinie{feature.isNew && <NewBadge />}
      </h2>
      <VersioningSelect
        label="Standard-Release"
        value={standard}
        onChange={(value) => {
          setStandard(value);
          setDraft(null);
        }}
        options={main.map((release) => ({ value: release.id, label: release.id }))}
      />
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={allowDrops}
          onChange={(event) => {
            setAllowDrops(event.target.checked);
            setDraft(null);
          }}
        />
        Entfernungen beim Angleichen ausdrücklich freigeben
      </label>
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        disabled={busy || !standard}
        onClick={() => void onPreview(standard, allowDrops).then(setDraft)}
      >
        Vorschau
      </Button>
      {draft && (
        <div className="space-y-2">
          <p>
            {draft.open.length} offene Änderungen bis {draft.standard} · {draft.variances.length}{" "}
            Abweichungen werden auf {draft.from} zurückgeführt
          </p>
          {draft.variances.length > 0 && (
            <p className="font-mono text-[11px]">{draft.variances.join(", ")}</p>
          )}
          {draft.issues.map((issue) => (
            <p key={issue.label} className="text-amber-600 dark:text-amber-400">
              {issue.label}: {issue.reason}
            </p>
          ))}
          {draft.sql && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px]">
              {draft.sql}
            </pre>
          )}
          <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>Angleich-Änderung speichern und committen, dann als Einzeländerung ausrollen.</li>
            <li>Abschließen: Abweichungen entfernen, Linie main, Teamkonfiguration committen.</li>
            <li>{draft.standard} wie gewohnt ausrollen.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !draft.change} onClick={() => onSave(draft)}>
              Angleich-Änderung committen
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onFinish(standard)}>
              Abschließen
            </Button>
          </div>
        </div>
      )}
      <Button size="sm" variant="ghost" className="self-start" onClick={onClose}>
        Schließen
      </Button>
    </div>
  );
}

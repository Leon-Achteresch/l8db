import { CircleAlertIcon } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { BaselineClassification, BaselineEntry } from "@/lib/versioning/change-plan";
import type { DatabaseTarget, Variance } from "@/lib/versioning/types";

export function VersioningBaselineReview({
  target,
  releaseId,
  result,
  busy,
  onConfirm,
  onCancel,
}: {
  target: DatabaseTarget;
  releaseId: string;
  result: BaselineClassification;
  busy: boolean;
  onConfirm: (deviations: { done: string[]; variances: Variance[] }) => void;
  onCancel: () => void;
}) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("versioning.targets.baseline-deviations");
  const [decisions, setDecisions] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      result.changes
        .filter((entry) => entry.status === "decision")
        .map((entry) => [entry.id, entry.suggested === "done"]),
    ),
  );
  const [reasons, setReasons] = useState<Record<string, string>>(() =>
    Object.fromEntries(result.variances.map((variance) => [variance.object, variance.reason])),
  );
  const group = (status: BaselineEntry["status"]) =>
    result.changes.filter((entry) => entry.status === status);
  const done = group("done");
  const open = group("open");
  const decide = group("decision");
  const lists: [string, BaselineEntry[]][] = [
    ["Offen", open],
    ["Erledigt", done],
  ];
  const invalidReason = result.variances.some((variance) => !reasons[variance.object]?.trim());
  const label = (entry: BaselineEntry) => (
    <>
      <span className="font-mono text-[10px] text-muted-foreground">{entry.id}</span> {entry.title}
      {entry.data ? " · Datenänderung" : ""}
    </>
  );
  return (
    <div
      ref={feature.ref}
      role="dialog"
      aria-label="Mit Altstand aufnehmen"
      className="flex flex-col gap-4 rounded-lg bg-muted/30 p-4 text-xs"
    >
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          {target.name}: mit Altstand aufnehmen · {releaseId}
          {feature.isNew && <NewBadge />}
        </h2>
        <p className="mt-1 text-muted-foreground">
          {done.length} erledigt · {open.length} offen · {decide.length} zu entscheiden ·{" "}
          {result.variances.length} Abweichungen. Es läuft kein SQL im Anwendungsschema; offene
          Änderungen spielt der nächste Rollout ein.
        </p>
      </div>
      {result.missing.length > 0 && (
        <p className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
          <CircleAlertIcon className="mt-0.5 size-3 shrink-0" />
          Beim Kunden fehlen {result.missing.join(", ")}, und keine Änderung legt sie an. Erst einen
          Release mit Grundstand wählen oder die Objekte anlegen.
        </p>
      )}
      {decide.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="font-medium">Bereits gelaufen?</h3>
          {decide.map((entry) => (
            <label key={entry.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={decisions[entry.id] ?? false}
                onChange={(event) =>
                  setDecisions((current) => ({ ...current, [entry.id]: event.target.checked }))
                }
              />
              <span>{label(entry)}</span>
            </label>
          ))}
        </section>
      )}
      {result.variances.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="font-medium">Als Abweichung festhalten</h3>
          {result.variances.map((variance) => (
            <div key={variance.object} className="flex items-center gap-2">
              <span className="w-48 truncate font-mono text-[11px]">{variance.object}</span>
              <Input
                aria-label={`Grund für ${variance.object}`}
                className="h-7 text-xs"
                value={reasons[variance.object] ?? ""}
                onChange={(event) =>
                  setReasons((current) => ({ ...current, [variance.object]: event.target.value }))
                }
              />
            </div>
          ))}
        </section>
      )}
      {lists.map(([title, entries]) =>
        entries.length ? (
          <details key={title}>
            <summary className="cursor-pointer font-medium">
              {title} · {entries.length}
            </summary>
            <ul className="mt-1.5 space-y-1">
              {entries.map((entry) => (
                <li key={entry.id}>{label(entry)}</li>
              ))}
            </ul>
          </details>
        ) : null,
      )}
      <div className="flex gap-2">
        <Button
          disabled={busy || result.missing.length > 0 || invalidReason}
          onClick={() =>
            onConfirm({
              done: [
                ...done.map((entry) => entry.id),
                ...decide.filter((entry) => decisions[entry.id]).map((entry) => entry.id),
              ],
              variances: result.variances.map((variance) => ({
                ...variance,
                reason: reasons[variance.object].trim(),
              })),
            })
          }
        >
          Aufnehmen
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConnectionsStore } from "@/lib/connections";
import { control, type PolicyRecord } from "@/lib/versioning/control";
import { identifier, releaseTrack } from "@/lib/versioning/model";
import { readTargets, saveTargets } from "@/lib/versioning/repository";
import type { DatabaseTarget } from "@/lib/versioning/types";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningSelect } from "./versioning-select";

export function VersioningTargetPolicy({
  workspace,
  target,
  onSaved,
}: {
  workspace: VersioningWorkspace;
  target: DatabaseTarget;
  onSaved: () => void;
}) {
  const [track, setTrack] = useState(target.track ?? "main");
  const [pin, setPin] = useState(target.pinnedRelease ?? "");
  const [paused, setPaused] = useState(target.paused ?? false);
  const loaded = useRef("");
  const [record, setRecord] = useState<PolicyRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [requireApproval, setRequireApproval] = useState(false);
  const [operators, setOperators] = useState("");
  const [reviewers, setReviewers] = useState("");
  const [administrators, setAdministrators] = useState("");
  const [production, setProduction] = useState(target.production);
  const connection = useConnectionsStore((state) =>
    state.connections.find((item) => item.id === target.connectionId),
  );
  useEffect(() => {
    if (!connection || !workspace.project || !target.release) return;
    const key = JSON.stringify([
      connection.id,
      connection.connectionString,
      workspace.project.id,
      target.id,
      target.database,
      target.schema,
      target.ledgerSchema,
    ]);
    if (loaded.current === key) return;
    let active = true;
    void control<PolicyRecord>(connection, workspace.project, target, "policy")
      .then((record) => {
        if (!active) return;
        loaded.current = key;
        setRecord(record);
        setTrack(record.policy.track);
        setPin(record.policy.pinnedRelease ?? "");
        setPaused(record.policy.paused);
        setRequireApproval(record.policy.requireApproval);
        setOperators(record.policy.operators.join(", "));
        setReviewers(record.policy.reviewers.join(", "));
        setAdministrators(record.policy.administrators.join(", "));
        setProduction(record.policy.production);
        setLoadError(null);
      })
      .catch((error) => {
        if (active) setLoadError(String(error));
      });
    return () => {
      active = false;
    };
  }, [connection, workspace.project, target]);
  const save = async () => {
    if (!workspace.project || !identifier(track))
      throw new Error("Gültige Release-Linie auswählen.");
    const { store, text } = await readTargets(workspace.repo, workspace.project.id);
    const current = store.targets.find((item) => item.id === target.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(target))
      throw new Error("Ziel wurde inzwischen geändert. Einstellungen neu öffnen.");
    if (
      pin &&
      !workspace.releases.some((release) => release.id === pin && releaseTrack(release) === track)
    )
      throw new Error("Freigegebener Release passt nicht zur Linie.");
    if (target.release) {
      if (!record || !connection)
        throw new Error("Gemeinsame Regeln zuerst laden. Bestehende Ziele einmal abgleichen.");
      const list = (value: string) => [
        ...new Set(
          value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ];
      const next = {
        ...record.policy,
        track,
        pinnedRelease: pin || null,
        paused,
        requireApproval,
        production,
        administrators: list(administrators),
        operators: list(operators),
        reviewers: list(reviewers),
      };
      if (requireApproval && !next.reviewers.length)
        throw new Error("Mindestens einen Freigeber angeben.");
      const saved = await control<PolicyRecord>(
        connection,
        workspace.project,
        target,
        "save-policy",
        { policy: next, revision: record.revision },
      );
      setRecord(saved);
      Object.assign(current, saved.policy);
    } else Object.assign(current, { track, pinnedRelease: pin || null, paused });
    await saveTargets(workspace.repo, store, text);
    await workspace.refresh();
    onSaved();
  };
  return (
    <details className="text-xs">
      <summary className="cursor-pointer py-2 font-medium">Update-Regeln</summary>
      <div className="mt-2 space-y-3">
        <VersioningSelect
          label={`Release-Linie: ${target.name}`}
          value={track}
          onChange={(value) => {
            setTrack(value);
            setPin("");
          }}
          options={[...new Set(["main", track, ...workspace.releases.map(releaseTrack)])].map(
            (value) => ({ value, label: value }),
          )}
        />
        <VersioningSelect
          label={`Maximaler Release: ${target.name}`}
          value={pin}
          onChange={setPin}
          options={[
            { value: "", label: "Kein Release-Limit" },
            ...workspace.releases
              .filter((release) => releaseTrack(release) === track)
              .map((release) => ({ value: release.id, label: release.id })),
          ]}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={paused}
            onChange={(event) => setPaused(event.target.checked)}
          />
          Updates pausieren
        </label>
        {target.release && (
          <>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={requireApproval}
                onChange={(event) => setRequireApproval(event.target.checked)}
              />
              Vier-Augen-Freigabe
            </label>
            <Input
              aria-label="Rollout-Benutzer"
              placeholder="Rollout-Benutzer, leer = alle"
              value={operators}
              onChange={(event) => setOperators(event.target.value)}
            />
            <Input
              aria-label="Freigeber"
              placeholder="Freigeber: DB-Benutzer, durch Komma getrennt"
              value={reviewers}
              onChange={(event) => setReviewers(event.target.value)}
            />
            <Input
              aria-label="Regeladministratoren"
              placeholder="Regeladministratoren: DB-Benutzer"
              value={administrators}
              onChange={(event) => setAdministrators(event.target.value)}
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={production}
                onChange={(event) => setProduction(event.target.checked)}
              />
              Produktionsschutz
            </label>
            <p className="text-[10px] text-muted-foreground">
              Gemeinsam in der Datenbank · Revision {record?.revision ?? "—"}. Freigaben benötigen
              einen anderen Datenbankbenutzer.
            </p>
            {loadError && (
              <p role="alert" className="text-destructive">
                {loadError}
              </p>
            )}
          </>
        )}
        <Button size="sm" onClick={() => void workspace.run(save, "Update-Regeln gespeichert")}>
          Regeln speichern
        </Button>
        {target.binding && (
          <p className="break-words text-[10px] text-muted-foreground">
            {target.binding.label}
            {target.binding.edition ? ` · ${target.binding.edition}` : ""}
          </p>
        )}
      </div>
    </details>
  );
}

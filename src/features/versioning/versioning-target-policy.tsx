import { useState } from "react";
import { Button } from "@/components/ui/button";
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
    Object.assign(current, { track, pinnedRelease: pin || null, paused });
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

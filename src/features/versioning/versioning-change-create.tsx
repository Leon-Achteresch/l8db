import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { createStandaloneChange } from "@/lib/versioning/change-files";
import type { DatabaseRelease, ReleaseCheck, VersioningProject } from "@/lib/versioning/types";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningCheckEditor } from "./versioning-check-editor";

export function VersioningChangeCreate({
  workspace,
  project,
  reference,
}: {
  workspace: VersioningWorkspace;
  project: VersioningProject;
  reference: DatabaseRelease | undefined;
}) {
  const feature = useNewFeatureVisibility<HTMLDetailsElement>("versioning.targets.change-rollout");
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [sql, setSql] = useState("");
  const [data, setData] = useState(false);
  const [touches, setTouches] = useState<Record<string, "check" | "before">>({});
  const [preconditions, setPreconditions] = useState<ReleaseCheck[]>([]);
  const hash = (objectId: string) =>
    reference?.objects.find((entry) => entry.object.id === objectId)?.checksum ?? null;
  const save = async () => {
    const touched = Object.keys(touches);
    await createStandaloneChange(workspace.repo, project, {
      id,
      title,
      sql,
      data,
      touches: touched,
      before: Object.fromEntries(
        touched
          .filter((objectId) => touches[objectId] === "before")
          .map((objectId) => [objectId, hash(objectId)]),
      ),
      preconditions,
    });
    setId("");
    setTitle("");
    setSql("");
    setData(false);
    setTouches({});
    setPreconditions([]);
    await workspace.refresh();
  };
  return (
    <details ref={feature.ref} className="text-xs">
      <summary className="flex cursor-pointer items-center gap-2 py-2 font-medium">
        Einzeländerung anlegen{feature.isNew && <NewBadge />}
      </summary>
      <div className="mt-2 space-y-3">
        <p className="text-[11px] text-muted-foreground">
          Einmal bauen, per Pull Request in main bringen und unter Kunden an mehrere Ziele
          verteilen. Ein späterer Release mit derselben Änderung führt sie nicht erneut aus.
        </p>
        <Input
          aria-label="Änderungs-ID"
          placeholder="z. B. 2026-11-05-index-waehrung"
          value={id}
          onChange={(event) => setId(event.target.value)}
        />
        <Input
          aria-label="Titel der Änderung"
          placeholder="Titel"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Textarea
          aria-label="SQL der Änderung"
          className="min-h-28 font-mono text-xs"
          value={sql}
          onChange={(event) => setSql(event.target.value)}
        />
        <div className="space-y-1">
          <p className="font-medium">Berührte Objekte</p>
          {project.objects.map((object) => (
            <div key={object.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={`${object.selection.objectName} berührt`}
                checked={object.id in touches}
                onChange={(event) =>
                  setTouches(({ [object.id]: _, ...rest }) =>
                    event.target.checked ? { ...rest, [object.id]: "check" } : rest,
                  )
                }
              />
              <span className="font-mono text-[11px]">{object.selection.objectName}</span>
              {object.id in touches && (
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={touches[object.id] === "before"}
                    onChange={(event) =>
                      setTouches((current) => ({
                        ...current,
                        [object.id]: event.target.checked ? "before" : "check",
                      }))
                    }
                  />
                  Stand aus {reference?.id ?? "dem neuesten Release"} voraussetzen
                </label>
              )}
            </div>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data}
            onChange={(event) => setData(event.target.checked)}
          />
          Reine Datenänderung
        </label>
        <VersioningCheckEditor
          label="Vorbedingungen"
          value={preconditions}
          onChange={setPreconditions}
        />
        <Button
          size="sm"
          disabled={workspace.busy || !id.trim() || !title.trim() || !sql.trim()}
          onClick={() =>
            void workspace.run(save, "Einzeländerung gespeichert. Committen und in main mergen.")
          }
        >
          Einzeländerung speichern
        </Button>
      </div>
    </details>
  );
}

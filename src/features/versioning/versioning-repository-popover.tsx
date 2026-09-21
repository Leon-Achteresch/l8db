import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpenIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { versioningRepository } from "@/lib/db";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningIconButton } from "./versioning-icon-button";
import { VersioningPopover } from "./versioning-popover";

export function VersioningRepositoryPopover({
  workspace,
  initial = false,
}: {
  workspace: VersioningWorkspace;
  initial?: boolean;
}) {
  const { repo, run, refresh, busy } = workspace;
  const [path, setPath] = useState(repo);
  useEffect(() => setPath(repo), [repo]);
  return (
    <VersioningPopover
      icon={FolderOpenIcon}
      label="Repository verwalten"
      disabled={busy}
      trigger={initial ? <Button size="sm">Repository verbinden</Button> : undefined}
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        Ein lokales Git-Repository für Definitionen, Branches und Releases.
      </p>
      <label htmlFor="vcs-repo-path" className="space-y-1.5 text-xs font-medium">
        Repository-Pfad
        <div className="flex gap-1">
          <Input
            id="vcs-repo-path"
            aria-label="Repository-Pfad"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/Projekte/meine-datenbank"
            className="min-w-0 text-xs"
          />
          <VersioningIconButton
            icon={FolderOpenIcon}
            label="Repository-Ordner auswählen"
            onClick={() =>
              void run(async () => {
                const selected = await open({ directory: true, multiple: false });
                if (selected) setPath(selected);
              })
            }
          />
        </div>
      </label>
      <Button size="sm" disabled={!path.trim()} onClick={() => void run(() => refresh(path))}>
        Repository öffnen
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={!path.trim()}
        onClick={() =>
          void run(async () => {
            if (workspace.dirty)
              throw new Error("Ungespeicherten Entwurf zuerst speichern oder verwerfen.");
            await versioningRepository({ action: "init", repo: path });
            await refresh(path);
          })
        }
      >
        Git initialisieren
      </Button>
    </VersioningPopover>
  );
}

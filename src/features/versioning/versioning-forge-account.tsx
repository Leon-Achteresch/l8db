import { ExternalLinkIcon, LogOutIcon, PlugZapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FORGE_LABELS, type ForgeInfo, forge, openForgeUrl } from "@/lib/versioning/forge";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningPopover } from "./versioning-popover";

export function VersioningForgeAccount({
  workspace,
  info,
  onChanged,
}: {
  workspace: VersioningWorkspace;
  info: ForgeInfo;
  onChanged: () => Promise<void>;
}) {
  const remote = info.remote;
  if (!remote) return null;
  return (
    <VersioningPopover icon={PlugZapIcon} label="Git-Plattform">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px]">
        <dt className="text-muted-foreground">Plattform</dt>
        <dd>{info.kind ? FORGE_LABELS[info.kind] : remote.host}</dd>
        <dt className="text-muted-foreground">Repository</dt>
        <dd className="truncate font-mono">{remote.path}</dd>
        <dt className="text-muted-foreground">Angemeldet als</dt>
        <dd>{info.account ?? "–"}</dd>
        {info.defaultBranch && (
          <>
            <dt className="text-muted-foreground">Hauptbranch</dt>
            <dd className="font-mono">{info.defaultBranch}</dd>
          </>
        )}
      </dl>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Alle Kunden teilen ein Repository. Änderungen kommen über Pull Requests in den Hauptbranch,
        ausgeliefert wird nur, was gemergt ist. Der Zugangstoken liegt im Schlüsselbund des
        Betriebssystems.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void workspace.run(() => openForgeUrl(remote.web))}
        >
          <ExternalLinkIcon className="size-3.5" />
          Im Browser öffnen
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() =>
            void workspace.run(async () => {
              await forge(workspace.repo, "disconnect");
              await onChanged();
            }, "Zugangstoken entfernt")
          }
        >
          <LogOutIcon className="size-3.5" />
          Verbindung trennen
        </Button>
      </div>
    </VersioningPopover>
  );
}

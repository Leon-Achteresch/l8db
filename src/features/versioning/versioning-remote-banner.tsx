import { useQuery } from "@tanstack/react-query";
import { GitBranchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { versioningRepository } from "@/lib/db";
import { remoteStatus } from "@/lib/versioning/delivery";
import type { VersioningWorkspace } from "./use-versioning";

export function VersioningRemoteBanner({ workspace }: { workspace: VersioningWorkspace }) {
  const { repo, status, run, refresh } = workspace;
  const remote = useQuery({
    queryKey: ["versioning-remote", repo, status?.head, status?.branch],
    enabled: Boolean(status),
    retry: false,
    staleTime: 10_000,
    queryFn: () => remoteStatus(repo),
  });
  const info = remote.data;
  if (!info) return null;
  const main = info.defaultBranch;
  const synchronize = () =>
    void run(async () => {
      await versioningRepository({ action: "fetch", repo });
      const current = await remoteStatus(repo);
      if (!current.defaultBranch)
        throw new Error("Der Hauptbranch des Remotes ist unbekannt. Remote-Einstellungen prüfen.");
      if (current.branch !== current.defaultBranch)
        await workspace.git("checkout", current.defaultBranch);
      await versioningRepository({ action: "pull", repo });
      await refresh();
      await remote.refetch();
    }, "Hauptbranch aktualisiert");
  if (!info.configured)
    return (
      <p className="rounded-xl bg-muted/35 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        Ohne gemeinsamen Remote „origin“ gibt es keine Reviews und keine Auslieferungsregeln.
      </p>
    );
  if (!main)
    return (
      <div className="flex items-center gap-3 rounded-xl bg-muted/35 px-3 py-2 text-[11px]">
        <p className="flex-1 leading-relaxed text-muted-foreground">
          Der Hauptbranch des Remotes ist noch unbekannt.
        </p>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={synchronize}>
          Abrufen
        </Button>
      </div>
    );
  if (info.branch === main && !info.ahead && !info.behind) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-amber-500/5 px-3 py-2">
      <GitBranchIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1 text-[11px] leading-relaxed">
        <p className="font-medium">Ausgeliefert wird nur der gemergte Stand von {main}.</p>
        <p className="text-muted-foreground">
          {info.branch !== main
            ? `Geöffnet ist ${info.branch ?? "ein losgelöster Stand"}.`
            : `${info.ahead ? `${info.ahead} lokale Commits fehlen im Remote. ` : ""}${info.behind ? `${info.behind} Commits sind noch nicht abgeholt.` : ""}`}
        </p>
      </div>
      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={synchronize}>
        {info.branch !== main ? `Auf ${main} wechseln` : "Aktualisieren"}
      </Button>
    </div>
  );
}

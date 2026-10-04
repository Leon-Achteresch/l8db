import { useQuery } from "@tanstack/react-query";
import { GitBranchIcon, PlusIcon, RocketIcon } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { versioningRepository } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { remoteStatus, targetStage } from "@/lib/versioning/delivery";
import { releaseTrack } from "@/lib/versioning/model";
import type { DatabaseTarget } from "@/lib/versioning/types";
import { customerGroups, targetProgress, type VersioningArea } from "@/lib/versioning/workflow";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningCustomerCreate } from "./versioning-customer-create";
import { VersioningDeliveryCell } from "./versioning-delivery-cell";

const STEPS = [
  "Änderung auf einem eigenen Branch entwickeln und als Release festschreiben",
  "Pull Request erstellen; Kolleginnen und Kollegen prüfen und geben frei",
  "In den Hauptbranch mergen",
  "Auf den Testsystemen der Kunden ausliefern und fachlich prüfen",
  "Denselben Release auf die Produktivsysteme ausliefern",
];

export function VersioningDelivery({
  workspace,
  onNavigate,
}: {
  workspace: VersioningWorkspace;
  onNavigate: (area: VersioningArea) => void;
}) {
  const feature = useNewFeatureVisibility<HTMLElement>("versioning.delivery");
  const { repo, project, releases, targets, status, run, refresh } = workspace;
  const [creating, setCreating] = useState(false);
  const remote = useQuery({
    queryKey: ["versioning-remote", repo, status?.head, status?.branch],
    enabled: Boolean(status),
    retry: false,
    staleTime: 10_000,
    queryFn: () => remoteStatus(repo),
  });
  if (!project || !targets) return null;
  const deliver = (list: DatabaseTarget[]) => {
    const release = releases
      .filter((entry) => releaseTrack(entry) === (list[0]?.track ?? "main"))
      .at(-1);
    workspace.setRequestedTargetIds(list.map((target) => target.id));
    if (release) workspace.setRequestedReleaseId(release.id);
    onNavigate("targets");
  };
  const pendingIn = (stage: "test" | "production") =>
    targets.targets.filter(
      (target) =>
        targetStage(target) === stage &&
        targetProgress(target, releases, status).state === "pending",
    );
  const info = remote.data;
  const main = info?.defaultBranch;
  const aside =
    info?.configured &&
    main &&
    (info.branch !== main || Boolean(info.ahead) || Boolean(info.behind));
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
  const groups = customerGroups(targets.targets);
  return (
    <section ref={feature.ref} className="space-y-5" aria-label="Auslieferung">
      <div className="flex items-center gap-2">
        <RocketIcon className="size-4 text-primary" />
        <h2 className="flex flex-1 items-center gap-2 text-sm font-semibold">
          Auslieferung{feature.isNew && <NewBadge />}
        </h2>
        <Button size="sm" variant="outline" onClick={() => setCreating((open) => !open)}>
          <PlusIcon className="size-3.5" />
          Kunde anlegen
        </Button>
      </div>
      <ol className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
        {STEPS.map((step, index) => (
          <li key={step} className="flex gap-2">
            <span className="w-3 shrink-0 text-right font-mono tabular-nums">{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      {info && !info.configured && (
        <p className="rounded-xl bg-muted/35 p-3 text-[11px] leading-relaxed text-muted-foreground">
          Für Reviews und Auslieferungsregeln braucht das Repository einen gemeinsamen Remote
          „origin“.
        </p>
      )}
      {info?.configured && !main && (
        <div className="flex items-center gap-3 rounded-xl bg-muted/35 p-3 text-[11px]">
          <p className="flex-1 leading-relaxed text-muted-foreground">
            Der Hauptbranch des Remotes ist noch unbekannt.
          </p>
          <Button size="sm" variant="outline" onClick={synchronize}>
            Abrufen
          </Button>
        </div>
      )}
      {aside && (
        <div className="flex items-start gap-3 rounded-xl bg-amber-500/5 p-3">
          <GitBranchIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1 text-[11px] leading-relaxed">
            <p className="font-medium">Ausgeliefert wird nur der gemergte Stand von {main}.</p>
            <p className="text-muted-foreground">
              {info.branch !== main
                ? `Geöffnet ist ${info.branch ?? "ein losgelöster Stand"}.`
                : `${info.ahead ? `${info.ahead} lokale Commits fehlen im Remote. ` : ""}${info.behind ? `${info.behind} Commits sind noch nicht abgeholt.` : ""}`}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={synchronize}>
            Auf {main} wechseln
          </Button>
        </div>
      )}
      {creating && (
        <VersioningCustomerCreate workspace={workspace} onDone={() => setCreating(false)} />
      )}
      {groups.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!pendingIn("test").length}
            onClick={() => deliver(pendingIn("test"))}
          >
            Alle Testsysteme ({pendingIn("test").length})
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!pendingIn("production").length}
            onClick={() => deliver(pendingIn("production"))}
          >
            Alle Produktivsysteme ({pendingIn("production").length})
          </Button>
        </div>
      )}
      <div className="space-y-3">
        {groups.map((group) => {
          const stages = {
            development: group.targets.filter((target) => targetStage(target) === "development"),
            test: group.targets.filter((target) => targetStage(target) === "test"),
            production: group.targets.filter((target) => targetStage(target) === "production"),
          };
          return (
            <section
              key={group.customer}
              aria-label={`Auslieferung: ${group.customer}`}
              className="rounded-xl bg-muted/25 p-3"
            >
              <header className="mb-2 flex items-baseline gap-2 px-1">
                <h3 className="min-w-0 flex-1 truncate text-xs font-semibold">{group.customer}</h3>
                {stages.development.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    + {stages.development.length} Entwicklung
                  </span>
                )}
              </header>
              <div className="grid grid-cols-2 gap-2">
                <VersioningDeliveryCell
                  stage="test"
                  targets={stages.test}
                  releases={releases}
                  status={status}
                  onDeliver={deliver}
                />
                <VersioningDeliveryCell
                  stage="production"
                  targets={stages.production}
                  releases={releases}
                  status={status}
                  tested={stages.test.flatMap((target) =>
                    target.release ? [target.release.id] : [],
                  )}
                  onDeliver={deliver}
                />
              </div>
            </section>
          );
        })}
      </div>
      {!groups.length && !creating && (
        <p className="px-1 py-6 text-center text-xs text-muted-foreground">
          Noch keine Kunden. Lege einen Kunden mit Test- und Produktivsystem an.
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Welche Prüfungen vor einer Auslieferung gelten, legen Regeladministratoren je Datenbank
        unter Kunden → Update-Regeln fest. Die Regeln liegen in der Zieldatenbank selbst und gelten
        für alle Teammitglieder.
      </p>
    </section>
  );
}

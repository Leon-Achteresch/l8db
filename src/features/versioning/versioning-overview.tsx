import { ArrowRightIcon, CheckCircle2Icon, CircleAlertIcon, ListTodoIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { deployable } from "@/lib/versioning/model";
import { changedFiles } from "@/lib/versioning/status";
import { customerGroups, targetProgress, type VersioningArea } from "@/lib/versioning/workflow";
import type { VersioningWorkspace } from "./use-versioning";

export function VersioningOverview({
  workspace,
  onNavigate,
}: {
  workspace: VersioningWorkspace;
  onNavigate: (area: VersioningArea) => void;
}) {
  const feature = useNewFeatureVisibility<HTMLElement>("versioning.overview");
  const { project, status, releases, targets } = workspace;
  if (!project) return null;
  const changes = changedFiles(status?.changes ?? "");
  const schemaChanges = [...changes.keys()].filter(
    (path) =>
      path === "database/project.json" ||
      path.startsWith("database/objects/") ||
      path.startsWith("database/releases/"),
  );
  const drafts = releases.filter(
    (release) => !status?.head || changes.has(`database/releases/${release.id}.json`),
  );
  const baseline = releases.some(
    (release) =>
      !release.parent && status?.head && !changes.has(`database/releases/${release.id}.json`),
  );
  const progress = (targets?.targets ?? []).map((target) => ({
    target,
    ...targetProgress(target, releases, status),
  }));
  const pending = progress.filter((entry) => entry.state === "pending");
  const blocked = progress.filter(
    (entry) => entry.state === "blocked" || entry.state === "baseline",
  );
  const steps: {
    area: VersioningArea;
    title: string;
    detail: string;
    done: boolean;
    action: string;
  }[] = [
    {
      area: "development",
      title: "Schema aufnehmen",
      detail: `${project.objects.length} verwaltete Objekte · Entwicklungsdatenbank vergleichen und Änderungen übernehmen.`,
      done: project.objects.length > 0,
      action: "Änderungen prüfen",
    },
    {
      area: "releases",
      title: baseline ? "Migration und Release erstellen" : "Ausgangsstand festhalten",
      detail: baseline
        ? "Aus dem Unterschied zum Vorgänger SQL erzeugen, Prüfungen ergänzen und den Release committen."
        : "Eine Baseline hält das vorhandene Schema ohne SQL-Ausführung fest.",
      done: baseline && drafts.length === 0 && schemaChanges.length === 0,
      action: baseline ? "Release vorbereiten" : "Baseline erstellen",
    },
    {
      area: "targets",
      title: "Kunden und Umgebungen zuordnen",
      detail: `${customerGroups(targets?.targets ?? []).length} Kunden · ${progress.length} Ziele auf eigenen Servern, Datenbanken oder Schemas.`,
      done: progress.length > 0 && blocked.length === 0,
      action: "Kunden verwalten",
    },
    {
      area: "targets",
      title: "Updates prüfen und ausrollen",
      detail: pending.length
        ? `${pending.length} Ziele warten auf Updates. Fehlende Zwischenreleases werden automatisch eingeplant.`
        : "Ziele auswählen, SQL und Vorprüfungen prüfen und die Rollout-Welle starten.",
      done: progress.length > 0 && pending.length === 0 && blocked.length === 0,
      action: "Rollout öffnen",
    },
  ];
  if (changes.size > 0 && schemaChanges.length === 0)
    steps.splice(2, 0, {
      area: "development",
      title: "Git-Dateien committen",
      detail: "Seeds und weitere Dateiänderungen prüfen und gezielt im aktuellen Branch committen.",
      done: false,
      action: "Dateien prüfen",
    });
  const visibleSteps = steps.filter(
    (step) => deployable(project.kind) || step.area === "development",
  );
  const next = visibleSteps.find((step) => !step.done) ?? visibleSteps[0];
  return (
    <section ref={feature.ref} className="space-y-6" aria-label="Versionierungsübersicht">
      <div className="flex items-center gap-2">
        <ListTodoIcon className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Was als Nächstes ansteht</h2>
        {feature.isNew && <NewBadge />}
      </div>
      <div className="rounded-xl bg-primary/5 p-4">
        <p className="text-[11px] text-muted-foreground">Nächster Schritt</p>
        <h3 className="mt-1 text-sm font-semibold">{next.title}</h3>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">{next.detail}</p>
        <Button size="sm" className="mt-3" onClick={() => onNavigate(next.area)}>
          {next.action}
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-border/60 text-center">
        {[
          { label: "Dateien offen", value: changes.size },
          { label: "Release-Entwürfe", value: drafts.length },
          { label: "Ziele mit Aufgaben", value: pending.length + blocked.length },
        ].map((item) => (
          <div key={item.label}>
            <dd className="font-mono text-xl font-semibold tabular-nums">{item.value}</dd>
            <dt className="mt-1 text-[11px] text-muted-foreground">{item.label}</dt>
          </div>
        ))}
      </dl>
      <ol className="divide-y divide-border/50">
        {visibleSteps.map((step, index) => (
          <li key={step.title} className="flex items-start gap-3 py-4">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px]">
              {step.done ? <CheckCircle2Icon className="size-4 text-emerald-600" /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-xs font-semibold">{step.title}</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {step.detail}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onNavigate(step.area)}
              aria-label={step.action}
            >
              <ArrowRightIcon className="size-3.5" />
            </Button>
          </li>
        ))}
      </ol>
      {blocked.length > 0 && (
        <div className="space-y-2 rounded-lg bg-amber-500/5 p-3">
          <p className="flex items-center gap-2 text-xs font-medium">
            <CircleAlertIcon className="size-4 text-amber-600" />
            Vor einem Rollout klären
          </p>
          {blocked.map((entry) => (
            <button
              key={entry.target.id}
              type="button"
              onClick={() => onNavigate("targets")}
              className="block text-left text-xs text-muted-foreground hover:text-foreground"
            >
              {entry.target.name} · {entry.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onNavigate("branches")}>
          Branches und Swimlanes
        </Button>
        {deployable(project.kind) && (
          <Button size="sm" variant="outline" onClick={() => onNavigate("seeds")}>
            Development-Daten vorbereiten
          </Button>
        )}
      </div>
    </section>
  );
}

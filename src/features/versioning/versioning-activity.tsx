import {
  CheckCircle2Icon,
  CircleAlertIcon,
  GitCommitHorizontalIcon,
  HistoryIcon,
} from "lucide-react";
import type { VersioningWorkspace } from "./use-versioning";

export function VersioningActivity({ workspace }: { workspace: VersioningWorkspace }) {
  const events =
    workspace.targets?.targets
      .flatMap((target) => target.history.map((event) => ({ target, event })))
      .sort((a, b) => b.event.startedAt.localeCompare(a.event.startedAt)) ?? [];
  const commits = workspace.status?.history.trim().split("\n").filter(Boolean) ?? [];
  return (
    <div className="space-y-7">
      <div>
        <h2 className="mb-3 text-xs font-semibold">
          Deployments{" "}
          <span className="ml-1 text-muted-foreground tabular-nums">{events.length}</span>
        </h2>
        {!events.length && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Noch keine Deployments. Hier erscheinen Rollouts und Abgleiche.
          </p>
        )}
        {events.map(({ target, event }) => (
          <details key={event.id} className="group py-3">
            <summary className="flex cursor-pointer list-none items-start gap-3">
              {event.status === "succeeded" || event.status === "reconciled" ? (
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              ) : (
                <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">
                  {target.name}
                  <span className="ml-2 font-mono font-normal text-muted-foreground">
                    {event.from?.id ?? "—"} → {event.to.id}
                  </span>
                </span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {new Date(event.startedAt).toLocaleString()} ·{" "}
                  {event.status === "succeeded"
                    ? "Abgeschlossen"
                    : event.status === "reconciled"
                      ? "Abgeglichen"
                      : event.status === "running"
                        ? "Läuft"
                        : "Prüfung erforderlich"}
                </span>
              </span>
            </summary>
            <div className="ml-7 mt-3 space-y-2 text-xs text-muted-foreground">
              <p>Migrationen: {event.completedMigrations.join(", ") || "Keine bestätigt"}</p>
              {event.error && (
                <pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-destructive/5 p-3 text-destructive">
                  {event.error}
                </pre>
              )}
            </div>
          </details>
        ))}
      </div>
      <div>
        <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold">
          <HistoryIcon className="size-3.5 text-muted-foreground" />
          Git-Historie
        </h2>
        {!commits.length && (
          <p className="text-xs text-muted-foreground">Noch keine Commits für dieses Projekt.</p>
        )}
        {commits.map((line) => {
          const [hash, ...subject] = line.split("\t");
          return (
            <div key={hash} className="flex items-start gap-3 py-2.5">
              <GitCommitHorizontalIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
              <p className="min-w-0 flex-1 text-xs">
                {subject.join("\t")}
                <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
                  {hash.slice(0, 8)}
                </span>
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

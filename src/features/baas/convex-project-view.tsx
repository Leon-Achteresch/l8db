import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ConvexProject, convexDeployments } from "@/lib/db";
import { ConvexEnvironmentView } from "./convex-environment-view";

export function ConvexProjectView({ id, project }: { id: string; project: ConvexProject }) {
  const deployments = useQuery({
    queryKey: ["convex", id, "deployments", project.id],
    queryFn: () => convexDeployments(id, project.id),
  });
  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{project.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {project.teamSlug} / {project.slug}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void openUrl(
              `https://dashboard.convex.dev/t/${encodeURIComponent(project.teamSlug)}/${encodeURIComponent(project.slug)}`,
            )
          }
        >
          Dashboard <ExternalLink className="size-3.5" />
        </Button>
      </div>
      {deployments.isPending ? (
        <p className="mt-4 text-xs text-muted-foreground">Deployments werden geladen…</p>
      ) : deployments.isError ? (
        <p role="alert" className="mt-4 text-xs text-destructive">
          {String(deployments.error)}
        </p>
      ) : deployments.data.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">Keine Deployments vorhanden.</p>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {deployments.data.map((deployment) => (
            <div key={deployment.name} className="min-w-0 rounded-xl border bg-background/60 p-3">
              <div className="flex items-center gap-2">
                <Server className="size-3.5 text-muted-foreground" />
                <span className="truncate text-xs font-medium">{deployment.name}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {deployment.deploymentType} · {deployment.region ?? deployment.kind}
                {deployment.isDefault ? " · Standard" : ""}
              </p>
              {deployment.deploymentUrl && (
                <p
                  className="mt-2 truncate font-mono text-[10px] text-muted-foreground"
                  title={deployment.deploymentUrl}
                >
                  {deployment.deploymentUrl}
                </p>
              )}
              {deployment.kind === "cloud" && (
                <ConvexEnvironmentView
                  id={id}
                  projectId={project.id}
                  deploymentName={deployment.name}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

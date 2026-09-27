import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronLeft, ChevronRight, ExternalLink, Globe2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { firebaseHostingSites } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function FirebaseHostingView({ projectId }: { projectId: string }) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.firebase.hosting");
  const [pages, setPages] = useState([""]);
  const sites = useQuery({
    queryKey: ["firebase", projectId, "hosting-sites", pages.at(-1)],
    queryFn: () => firebaseHostingSites(projectId, pages.at(-1) || undefined),
  });

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div ref={feature.ref} className="flex items-center gap-2">
          <Globe2 className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Firebase Hosting</h3>
          {feature.isNew && <NewBadge />}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Firebase Hosting aktualisieren"
          onClick={() => void sites.refetch()}
          disabled={sites.isFetching}
        >
          <RefreshCw className={`size-3.5 ${sites.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {sites.isPending ? (
        <p className="mt-4 text-xs text-muted-foreground">Sites werden geladen…</p>
      ) : sites.isError ? (
        <p role="alert" className="mt-4 text-xs text-destructive">
          {String(sites.error)}
        </p>
      ) : (
        <>
          {sites.data.sites.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Keine Hosting-Sites auf dieser Seite.
            </p>
          ) : (
            <div className="mt-4 divide-y">
              {sites.data.sites.map((site) => (
                <div
                  key={site.name}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{site.name.split("/").at(-1)}</p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {site.defaultUrl ?? site.type ?? "Keine URL"}
                    </p>
                  </div>
                  {site.defaultUrl?.startsWith("https://") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void openUrl(site.defaultUrl ?? "")}
                    >
                      Öffnen <ExternalLink className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {(pages.length > 1 || sites.data.nextPageToken) && (
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pages.length === 1}
                onClick={() => setPages((current) => current.slice(0, -1))}
              >
                <ChevronLeft className="size-3.5" /> Zurück
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!sites.data.nextPageToken}
                onClick={() => {
                  const nextPageToken = sites.data.nextPageToken;
                  if (nextPageToken) setPages((current) => [...current, nextPageToken]);
                }}
              >
                Weiter <ChevronRight className="size-3.5" />
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

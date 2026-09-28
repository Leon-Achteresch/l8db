import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronLeft, ChevronRight, ExternalLink, Globe2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { firebaseHostingReleases, firebaseHostingSites } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function FirebaseHostingView({ projectId }: { projectId: string }) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.firebase.hosting");
  const releaseFeature = useNewFeatureVisibility<HTMLDivElement>("baas.firebase.hosting-releases");
  const [pages, setPages] = useState([""]);
  const [selectedSiteName, setSelectedSiteName] = useState<string | null>(null);
  const [releasePages, setReleasePages] = useState([""]);
  const sites = useQuery({
    queryKey: ["firebase", projectId, "hosting-sites", pages.at(-1)],
    queryFn: () => firebaseHostingSites(projectId, pages.at(-1) || undefined),
  });
  const selectedSite =
    sites.data?.sites.find((site) => site.name === selectedSiteName) ?? sites.data?.sites[0];
  const siteId = selectedSite?.name.split("/").at(-1);
  const releases = useQuery({
    queryKey: ["firebase", projectId, "hosting-releases", siteId, releasePages.at(-1)],
    queryFn: () =>
      firebaseHostingReleases(projectId, siteId ?? "", releasePages.at(-1) || undefined),
    enabled: Boolean(siteId),
  });

  function changeSitePage(token: string | null) {
    setPages((current) => (token ? [...current, token] : current.slice(0, -1)));
    setSelectedSiteName(null);
    setReleasePages([""]);
  }

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
                  <button
                    type="button"
                    aria-pressed={selectedSite?.name === site.name}
                    className="min-w-0 text-left hover:text-primary"
                    onClick={() => {
                      setSelectedSiteName(site.name);
                      setReleasePages([""]);
                    }}
                  >
                    <p className="truncate text-xs font-medium">{site.name.split("/").at(-1)}</p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {site.defaultUrl ?? site.type ?? "Keine URL"}
                    </p>
                  </button>
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
                onClick={() => changeSitePage(null)}
              >
                <ChevronLeft className="size-3.5" /> Zurück
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!sites.data.nextPageToken}
                onClick={() => {
                  const nextPageToken = sites.data.nextPageToken;
                  if (nextPageToken) changeSitePage(nextPageToken);
                }}
              >
                Weiter <ChevronRight className="size-3.5" />
              </Button>
            </div>
          )}
          {selectedSite && (
            <div className="mt-4 border-t pt-4">
              <div className="flex items-center justify-between gap-3">
                <div ref={releaseFeature.ref} className="flex items-center gap-2">
                  <h4 className="text-xs font-medium">
                    Releases · {selectedSite.name.split("/").at(-1)}
                  </h4>
                  {releaseFeature.isNew && <NewBadge />}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Hosting-Releases aktualisieren"
                  onClick={() => void releases.refetch()}
                  disabled={releases.isFetching}
                >
                  <RefreshCw className={`size-3.5 ${releases.isFetching ? "animate-spin" : ""}`} />
                </Button>
              </div>
              {releases.isPending ? (
                <p className="mt-3 text-xs text-muted-foreground">Releases werden geladen…</p>
              ) : releases.isError ? (
                <p role="alert" className="mt-3 text-xs text-destructive">
                  {String(releases.error)}
                </p>
              ) : (
                <>
                  {releases.data.releases.length === 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Keine Releases auf dieser Seite.
                    </p>
                  ) : (
                    <div className="mt-3 divide-y">
                      {releases.data.releases.map((release) => (
                        <div key={release.name} className="py-2.5 first:pt-0">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-medium">{release.type ?? "Release"}</span>
                            <span className="text-muted-foreground">
                              {release.releaseTime
                                ? new Date(release.releaseTime).toLocaleString("de-DE")
                                : "Zeit unbekannt"}
                            </span>
                          </div>
                          {release.message && (
                            <p className="mt-1 break-words text-xs">{release.message}</p>
                          )}
                          {release.version?.name && (
                            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                              {release.version.name}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {(releasePages.length > 1 || releases.data.nextPageToken) && (
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={releasePages.length === 1}
                        onClick={() => setReleasePages((current) => current.slice(0, -1))}
                      >
                        <ChevronLeft className="size-3.5" /> Zurück
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!releases.data.nextPageToken}
                        onClick={() => {
                          const nextPageToken = releases.data.nextPageToken;
                          if (nextPageToken)
                            setReleasePages((current) => [...current, nextPageToken]);
                        }}
                      >
                        Weiter <ChevronRight className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

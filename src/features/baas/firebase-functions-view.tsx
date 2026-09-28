import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, Code2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { firebaseFunctions } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function FirebaseFunctionsView({ projectId }: { projectId: string }) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.firebase.functions");
  const [pages, setPages] = useState([""]);
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const functions = useQuery({
    queryKey: ["firebase", projectId, "functions", pages.at(-1)],
    queryFn: () => firebaseFunctions(projectId, pages.at(-1) || undefined),
  });

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div ref={feature.ref} className="flex items-center gap-2">
          <Code2 className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Cloud Functions</h3>
          {feature.isNew && <NewBadge />}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Firebase Functions aktualisieren"
          onClick={() => void functions.refetch()}
          disabled={functions.isFetching}
        >
          <RefreshCw className={`size-3.5 ${functions.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {functions.isPending ? (
        <p className="mt-4 text-xs text-muted-foreground">Functions werden geladen…</p>
      ) : functions.isError ? (
        <p role="alert" className="mt-4 text-xs text-destructive">
          {String(functions.error)}
        </p>
      ) : (
        <>
          {functions.data.unreachable.length > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              Nicht erreichbare Regionen: {functions.data.unreachable.join(", ")}
            </p>
          )}
          {functions.data.functions.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">Keine Functions auf dieser Seite.</p>
          ) : (
            <div className="mt-4 divide-y">
              {functions.data.functions.map((item) => (
                <div key={item.name} className="py-2.5 first:pt-0">
                  <button
                    type="button"
                    aria-expanded={expandedName === item.name}
                    className="flex w-full items-center gap-2 text-left text-xs hover:text-primary"
                    onClick={() =>
                      setExpandedName((current) => (current === item.name ? null : item.name))
                    }
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {item.name.split("/").at(-1)}
                    </span>
                    <span className="text-muted-foreground">
                      {item.state ?? "Status unbekannt"}
                    </span>
                    <ChevronDown
                      className={`size-3.5 shrink-0 transition-transform ${expandedName === item.name ? "rotate-180" : ""}`}
                    />
                  </button>
                  <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                    {item.name.split("/")[3] ?? ""} · {item.environment ?? ""}
                  </p>
                  {expandedName === item.name && (
                    <dl className="mt-3 grid gap-3 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Laufzeit</dt>
                        <dd className="mt-0.5">{item.buildConfig?.runtime ?? "Nicht angegeben"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Einstiegspunkt</dt>
                        <dd className="mt-0.5 break-all">
                          {item.buildConfig?.entryPoint ?? "Nicht angegeben"}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-muted-foreground">Beschreibung</dt>
                        <dd className="mt-0.5 break-words">{item.description || "Keine"}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-muted-foreground">URL</dt>
                        <dd className="mt-0.5 break-all font-mono">{item.url ?? "Keine"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Aktualisiert</dt>
                        <dd className="mt-0.5">
                          {item.updateTime
                            ? new Date(item.updateTime).toLocaleString("de-DE")
                            : "Nicht angegeben"}
                        </dd>
                      </div>
                    </dl>
                  )}
                </div>
              ))}
            </div>
          )}
          {(pages.length > 1 || functions.data.nextPageToken) && (
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pages.length === 1}
                onClick={() => {
                  setPages((current) => current.slice(0, -1));
                  setExpandedName(null);
                }}
              >
                <ChevronLeft className="size-3.5" /> Zurück
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!functions.data.nextPageToken}
                onClick={() => {
                  const nextPageToken = functions.data.nextPageToken;
                  if (nextPageToken) {
                    setPages((current) => [...current, nextPageToken]);
                    setExpandedName(null);
                  }
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

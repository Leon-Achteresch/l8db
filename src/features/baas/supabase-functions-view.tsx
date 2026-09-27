import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, ExternalLink, FunctionSquare } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { supabaseFunctions } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function SupabaseFunctionsView({ reference }: { reference: string }) {
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.supabase.function-details");
  const functions = useQuery({
    queryKey: ["supabase", reference, "functions"],
    queryFn: () => supabaseFunctions(reference),
  });

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <FunctionSquare className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Edge Functions</h3>
        {functions.data && (
          <span className="ml-auto text-xs text-muted-foreground">{functions.data.length}</span>
        )}
      </div>
      {functions.isPending ? (
        <p className="mt-5 text-xs text-muted-foreground">Wird geladen…</p>
      ) : functions.isError ? (
        <p role="alert" className="mt-5 text-xs text-destructive">
          {String(functions.error)}
        </p>
      ) : functions.data.length === 0 ? (
        <p className="mt-5 text-xs text-muted-foreground">Keine Edge Functions vorhanden.</p>
      ) : (
        <div className="mt-4 divide-y">
          {functions.data.map((item, index) => (
            <div key={item.slug} className="py-3 first:pt-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left font-mono text-xs font-medium hover:text-primary"
                  aria-expanded={expandedSlug === item.slug}
                  onClick={() =>
                    setExpandedSlug((current) => (current === item.slug ? null : item.slug))
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{item.name || item.slug}</span>
                  {feature.isNew && index === 0 && <NewBadge />}
                  <ChevronDown
                    className={`size-3.5 shrink-0 transition-transform ${expandedSlug === item.slug ? "rotate-180" : ""}`}
                  />
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${item.slug} im Supabase-Dashboard öffnen`}
                  onClick={() =>
                    void openUrl(
                      `https://supabase.com/dashboard/project/${reference}/functions/${encodeURIComponent(item.slug)}`,
                    )
                  }
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {item.status ?? "Status unbekannt"}
                {item.version == null ? "" : ` · v${item.version}`}
              </p>
              {expandedSlug === item.slug && (
                <div ref={feature.ref} className="mt-3 rounded-lg bg-muted/40 p-3">
                  <dl className="grid gap-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Slug</dt>
                      <dd className="mt-0.5 break-all font-mono">{item.slug}</dd>
                    </div>
                    {item.id && (
                      <div>
                        <dt className="text-muted-foreground">ID</dt>
                        <dd className="mt-0.5 break-all font-mono">{item.id}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-muted-foreground">JWT-Prüfung</dt>
                      <dd className="mt-0.5">
                        {item.verify_jwt == null
                          ? "Nicht angegeben"
                          : item.verify_jwt
                            ? "Aktiv"
                            : "Inaktiv"}
                      </dd>
                    </div>
                    {item.entrypoint_path && (
                      <div>
                        <dt className="text-muted-foreground">Einstiegspunkt</dt>
                        <dd className="mt-0.5 break-all font-mono">{item.entrypoint_path}</dd>
                      </div>
                    )}
                    {item.import_map_path && (
                      <div>
                        <dt className="text-muted-foreground">Import Map</dt>
                        <dd className="mt-0.5 break-all font-mono">{item.import_map_path}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

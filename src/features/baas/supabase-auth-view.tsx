import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { supabaseAuthUsers, supabaseHasProjectKey } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

function formatDate(value: string | null): string {
  if (!value) return "Nicht angegeben";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("de-DE") : value;
}

export function SupabaseAuthView({ reference }: { reference: string }) {
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.supabase.auth-details");
  const hasKey = useQuery({
    queryKey: ["supabase", reference, "has-project-key"],
    queryFn: () => supabaseHasProjectKey(reference),
  });
  const users = useQuery({
    queryKey: ["supabase", reference, "auth-users", page],
    queryFn: () => supabaseAuthUsers(reference, page),
    enabled: hasKey.data === true,
  });

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Auth-Benutzer</h3>
        {users.data && <span className="ml-auto text-xs text-muted-foreground">Seite {page}</span>}
      </div>
      {hasKey.isPending ? (
        <p className="mt-4 text-xs text-muted-foreground">Zugriff wird geprüft…</p>
      ) : hasKey.isError ? (
        <p role="alert" className="mt-4 text-xs text-destructive">
          {String(hasKey.error)}
        </p>
      ) : !hasKey.data ? (
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Hinterlege den Projekt API Key oben, um Auth-Benutzer zu sehen.
        </p>
      ) : users.isPending ? (
        <p className="mt-4 text-xs text-muted-foreground">Benutzer werden geladen…</p>
      ) : users.isError ? (
        <p role="alert" className="mt-4 text-xs text-destructive">
          {String(users.error)}
        </p>
      ) : users.data.users.length === 0 ? (
        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Keine Benutzer auf dieser Seite.</p>
          {page > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPage((value) => value - 1);
                setExpandedId(null);
              }}
            >
              <ChevronLeft className="size-3.5" /> Zurück
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="mt-4 divide-y">
            {users.data.users.map((user, index) => (
              <div key={user.id} className="py-2.5 first:pt-0">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 text-left text-xs font-medium hover:text-primary"
                  aria-expanded={expandedId === user.id}
                  onClick={() => setExpandedId((current) => (current === user.id ? null : user.id))}
                >
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={user.email ?? user.phone ?? user.id}
                  >
                    {user.email ?? user.phone ?? user.id}
                  </span>
                  {feature.isNew && index === 0 && <NewBadge />}
                  <ChevronDown
                    className={`size-3.5 shrink-0 transition-transform ${expandedId === user.id ? "rotate-180" : ""}`}
                  />
                </button>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">{user.id}</p>
                {expandedId === user.id && (
                  <div ref={feature.ref} className="mt-3 rounded-lg bg-muted/40 p-3">
                    <dl className="grid gap-3 text-xs">
                      <div>
                        <dt className="text-muted-foreground">E-Mail</dt>
                        <dd className="mt-0.5 break-all">{user.email || "Keine"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Telefon</dt>
                        <dd className="mt-0.5 break-all">{user.phone || "Keines"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">E-Mail bestätigt</dt>
                        <dd className="mt-0.5">
                          {user.email
                            ? user.email_confirmed_at
                              ? formatDate(user.email_confirmed_at)
                              : "Nein"
                            : "Keine E-Mail"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Telefon bestätigt</dt>
                        <dd className="mt-0.5">
                          {user.phone
                            ? user.phone_confirmed_at
                              ? formatDate(user.phone_confirmed_at)
                              : "Nein"
                            : "Kein Telefon"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Kontoart</dt>
                        <dd className="mt-0.5">
                          {user.is_anonymous == null
                            ? "Nicht angegeben"
                            : user.is_anonymous
                              ? "Anonym"
                              : "Registriert"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Erstellt</dt>
                        <dd className="mt-0.5">{formatDate(user.created_at)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Letzte Anmeldung</dt>
                        <dd className="mt-0.5">
                          {user.last_sign_in_at ? formatDate(user.last_sign_in_at) : "Noch nie"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => {
                setPage((value) => value - 1);
                setExpandedId(null);
              }}
            >
              <ChevronLeft className="size-3.5" /> Zurück
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={users.data.users.length < 50}
              onClick={() => {
                setPage((value) => value + 1);
                setExpandedId(null);
              }}
            >
              Weiter <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

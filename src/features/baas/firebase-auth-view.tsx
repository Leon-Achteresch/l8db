import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Users } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { firebaseAuthUsers } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

function formatMillis(value: string | null): string {
  if (!value) return "Nicht angegeben";
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return value;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("de-DE") : value;
}

export function FirebaseAuthView({ projectId }: { projectId: string }) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.firebase.auth");
  const [pages, setPages] = useState([""]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pageToken = pages.at(-1) ?? "";
  const users = useQuery({
    queryKey: ["firebase", projectId, "auth-users", pageToken],
    queryFn: () => firebaseAuthUsers(projectId, pageToken || undefined),
  });

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div ref={feature.ref} className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Auth-Benutzer</h3>
          {feature.isNew && <NewBadge />}
          {users.data && (
            <span className="text-xs text-muted-foreground">Seite {pages.length}</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Auth-Benutzer aktualisieren"
          onClick={() => void users.refetch()}
          disabled={users.isFetching}
        >
          <RefreshCw className={`size-3.5 ${users.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {users.isPending ? (
        <p className="mt-4 text-xs text-muted-foreground">Benutzer werden geladen…</p>
      ) : users.isError ? (
        <p role="alert" className="mt-4 text-xs text-destructive">
          {String(users.error)}
        </p>
      ) : (
        <>
          {users.data.users.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">Keine Benutzer auf dieser Seite.</p>
          ) : (
            <div className="mt-4 divide-y">
              {users.data.users.map((user) => (
                <div key={user.localId} className="py-2.5 first:pt-0">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 text-left text-xs font-medium hover:text-primary"
                    aria-expanded={expandedId === user.localId}
                    onClick={() =>
                      setExpandedId((current) => (current === user.localId ? null : user.localId))
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {user.displayName || user.email || user.phoneNumber || user.localId}
                    </span>
                    <ChevronDown
                      className={`size-3.5 shrink-0 transition-transform ${expandedId === user.localId ? "rotate-180" : ""}`}
                    />
                  </button>
                  <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                    {user.localId}
                  </p>
                  {expandedId === user.localId && (
                    <dl className="mt-3 grid gap-3 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">E-Mail</dt>
                        <dd className="mt-0.5 break-all">{user.email || "Keine"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Telefon</dt>
                        <dd className="mt-0.5 break-all">{user.phoneNumber || "Keines"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">E-Mail bestätigt</dt>
                        <dd className="mt-0.5">
                          {user.emailVerified == null
                            ? "Nicht angegeben"
                            : user.emailVerified
                              ? "Ja"
                              : "Nein"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Konto</dt>
                        <dd className="mt-0.5">
                          {user.disabled == null
                            ? "Status unbekannt"
                            : user.disabled
                              ? "Deaktiviert"
                              : "Aktiv"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Anbieter</dt>
                        <dd className="mt-0.5 break-words">
                          {user.providerUserInfo.length
                            ? user.providerUserInfo
                                .map((provider) => provider.providerId)
                                .join(", ")
                            : "Nicht angegeben"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Erstellt</dt>
                        <dd className="mt-0.5">{formatMillis(user.createdAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Letzte Anmeldung</dt>
                        <dd className="mt-0.5">
                          {user.lastLoginAt ? formatMillis(user.lastLoginAt) : "Noch nie"}
                        </dd>
                      </div>
                    </dl>
                  )}
                </div>
              ))}
            </div>
          )}
          {(pages.length > 1 || users.data.nextPageToken) && (
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pages.length === 1}
                onClick={() => {
                  setPages((current) => current.slice(0, -1));
                  setExpandedId(null);
                }}
              >
                <ChevronLeft className="size-3.5" /> Zurück
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!users.data.nextPageToken}
                onClick={() => {
                  const nextPageToken = users.data.nextPageToken;
                  if (nextPageToken) {
                    setPages((current) => [...current, nextPageToken]);
                    setExpandedId(null);
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

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  supabaseAuthUsers,
  supabaseCreateAuthUser,
  supabaseDeleteAuthUser,
  supabaseHasProjectKey,
  supabaseUpdateAuthUserEmail,
} from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

function formatDate(value: string | null): string {
  if (!value) return "Nicht angegeben";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("de-DE") : value;
}

export function SupabaseAuthView({ reference }: { reference: string }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.supabase.auth-details");
  const manageFeature = useNewFeatureVisibility<HTMLFormElement>("baas.supabase.auth-manage");
  const hasKey = useQuery({
    queryKey: ["supabase", reference, "has-project-key"],
    queryFn: () => supabaseHasProjectKey(reference),
  });
  const users = useQuery({
    queryKey: ["supabase", reference, "auth-users", page],
    queryFn: () => supabaseAuthUsers(reference, page),
    enabled: hasKey.data === true,
  });

  async function createUser() {
    setBusy(true);
    setActionError(null);
    try {
      await supabaseCreateAuthUser(reference, createEmail.trim(), createPassword);
      setCreateEmail("");
      setCreatePassword("");
      setActionSuccess("Benutzer erstellt.");
      setPage(1);
      await queryClient.invalidateQueries({ queryKey: ["supabase", reference, "auth-users"] });
    } catch (reason) {
      setActionError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function updateEmail() {
    if (!expandedId) return;
    setBusy(true);
    setActionError(null);
    try {
      await supabaseUpdateAuthUserEmail(reference, expandedId, editEmail.trim());
      setActionSuccess("E-Mail-Adresse geändert.");
      await queryClient.invalidateQueries({ queryKey: ["supabase", reference, "auth-users"] });
    } catch (reason) {
      setActionError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setBusy(true);
    setActionError(null);
    try {
      await supabaseDeleteAuthUser(reference, target);
      setDeleteTarget(null);
      setExpandedId(null);
      setActionSuccess("Benutzer gelöscht.");
      await queryClient.invalidateQueries({ queryKey: ["supabase", reference, "auth-users"] });
    } catch (reason) {
      setActionError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Auth-Benutzer</h3>
        {users.data && <span className="ml-auto text-xs text-muted-foreground">Seite {page}</span>}
      </div>
      {hasKey.data && (
        <form
          ref={manageFeature.ref}
          className="mt-4 flex flex-wrap gap-2 rounded-xl border bg-background/50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void createUser();
          }}
        >
          <Input
            className="h-8 min-w-40 flex-1 text-xs"
            type="email"
            value={createEmail}
            onChange={(event) => setCreateEmail(event.target.value)}
            placeholder="E-Mail"
            aria-label="Neue Benutzer-E-Mail"
            required
            disabled={busy}
          />
          <Input
            className="h-8 min-w-40 flex-1 text-xs"
            type="password"
            value={createPassword}
            onChange={(event) => setCreatePassword(event.target.value)}
            placeholder="Passwort"
            aria-label="Neues Benutzerpasswort"
            minLength={6}
            required
            disabled={busy}
          />
          <Button size="sm" type="submit" disabled={busy}>
            <Plus className="size-3.5" /> Erstellen
          </Button>
          {manageFeature.isNew && <NewBadge />}
        </form>
      )}
      {actionError && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {actionError}
        </p>
      )}
      {actionSuccess && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {actionSuccess}
        </p>
      )}
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
                  onClick={() => {
                    setExpandedId((current) => (current === user.id ? null : user.id));
                    setEditEmail(user.email ?? "");
                  }}
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
                    <form
                      className="mt-3 flex flex-wrap gap-2 border-t pt-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void updateEmail();
                      }}
                    >
                      <Input
                        className="h-8 min-w-40 flex-1 text-xs"
                        type="email"
                        value={editEmail}
                        onChange={(event) => setEditEmail(event.target.value)}
                        aria-label="E-Mail-Adresse bearbeiten"
                        required
                        disabled={busy}
                      />
                      <Button size="sm" variant="outline" type="submit" disabled={busy}>
                        E-Mail speichern
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() => setDeleteTarget(user.id)}
                        disabled={busy}
                      >
                        <Trash2 className="size-3.5" /> Löschen
                      </Button>
                    </form>
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
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Benutzer löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Benutzer {deleteTarget} wird endgültig gelöscht. Der Vorgang kann nicht rückgängig
              gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void deleteUser();
              }}
            >
              {busy ? "Löscht…" : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

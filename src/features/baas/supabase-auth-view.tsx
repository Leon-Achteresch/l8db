import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabaseAuthUsers, supabaseHasProjectKey } from "@/lib/db";

export function SupabaseAuthView({ reference }: { reference: string }) {
  const [page, setPage] = useState(1);
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
            <Button variant="outline" size="sm" onClick={() => setPage((value) => value - 1)}>
              <ChevronLeft className="size-3.5" /> Zurück
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="mt-4 divide-y">
            {users.data.users.map((user) => (
              <div key={user.id} className="py-2.5 first:pt-0">
                <p
                  className="truncate text-xs font-medium"
                  title={user.email ?? user.phone ?? user.id}
                >
                  {user.email ?? user.phone ?? user.id}
                </p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">{user.id}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft className="size-3.5" /> Zurück
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={users.data.users.length < 50}
              onClick={() => setPage((value) => value + 1)}
            >
              Weiter <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

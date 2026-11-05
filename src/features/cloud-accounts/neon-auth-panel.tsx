import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CLOUD_QUERY_OPTIONS,
  neonAuth,
  neonAuthCreateUser,
  neonAuthDeleteUser,
  neonAuthEnable,
  neonAuthUsers,
} from "@/lib/db/cloud-accounts";
import { cloudErrorText } from "./add-cloud-connection";
import { CloudConfirmButton } from "./cloud-confirm-button";
import { CloudSectionError } from "./cloud-section-error";

const PAGE = 50;

export function NeonAuthPanel({
  accountId,
  projectId,
  branchId,
}: {
  accountId: string;
  projectId: string;
  branchId: string;
}) {
  const queryClient = useQueryClient();
  const scope = ["cloud-accounts", accountId, "neon", projectId, branchId, "auth"] as const;
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const state = useQuery({
    queryKey: [...scope, "state"],
    queryFn: () => neonAuth(accountId, projectId, branchId),
    ...CLOUD_QUERY_OPTIONS,
  });
  const users = useQuery({
    queryKey: [...scope, "users", offset, applied],
    queryFn: () => neonAuthUsers(accountId, projectId, branchId, offset, applied),
    enabled: state.data?.enabled === true,
    ...CLOUD_QUERY_OPTIONS,
  });

  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await queryClient.invalidateQueries({ queryKey: scope });
      return true;
    } catch (reason) {
      toast.error(cloudErrorText(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (state.isLoading) return <p className="text-sm text-muted-foreground">Lade Neon Auth…</p>;
  if (state.isError) {
    return <CloudSectionError error={state.error} onRetry={() => void state.refetch()} />;
  }
  if (!state.data?.enabled) {
    return (
      <div className="flex max-w-xl flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Neon Auth (Managed Better Auth, Beta) ist auf diesem Branch nicht aktiviert.
        </p>
        <CloudConfirmButton
          label="Neon Auth aktivieren"
          variant="default"
          busy={busy}
          title="Neon Auth aktivieren?"
          confirmLabel="Aktivieren"
          description={
            <span>
              Neon legt auf diesem Branch das Schema neon_auth mit Nutzer- und Sitzungstabellen an.
              Eventuell gelieferte Schlüssel speichert l8db nur im Schlüsselbund.
            </span>
          }
          onConfirm={() =>
            void run(
              () => neonAuthEnable(accountId, projectId, branchId, null, true),
              "Neon Auth aktiviert",
            )
          }
        />
      </div>
    );
  }

  const config = state.data.config;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">{config?.auth_provider ?? "aktiv"}</Badge>
        {config?.db_name && <span>Datenbank: {config.db_name}</span>}
        {config?.base_url && (
          <span className="truncate text-muted-foreground">{config.base_url}</span>
        )}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            () => neonAuthCreateUser(accountId, projectId, branchId, email, name),
            "Nutzer angelegt",
          ).then((created) => {
            if (!created) return;
            setEmail("");
            setName("");
          });
        }}
      >
        <Input
          aria-label="E-Mail des neuen Nutzers"
          type="email"
          placeholder="E-Mail"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-56"
          required
        />
        <Input
          aria-label="Name des neuen Nutzers"
          placeholder="Name (optional)"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-44"
        />
        <Button type="submit" size="sm" disabled={busy || !email.trim()}>
          <UserPlus className="size-3.5" />
          Nutzer anlegen
        </Button>
      </form>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setApplied(search.trim());
        }}
      >
        <Input
          aria-label="Nutzer suchen"
          placeholder="Nach E-Mail oder Name suchen"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-72"
        />
        <Button type="submit" size="sm" variant="outline">
          Suchen
        </Button>
      </form>
      {users.isError && (
        <CloudSectionError error={users.error} onRetry={() => void users.refetch()} />
      )}
      {users.isLoading && <p className="text-sm text-muted-foreground">Lade Nutzer…</p>}
      {users.data && (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">E-Mail</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Rolle</th>
                <th className="px-3 py-2 font-medium">Angelegt</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.data.users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                    Keine Nutzer gefunden.
                  </td>
                </tr>
              )}
              {users.data.users.map((user) => (
                <tr key={user.id} className="border-t">
                  <td className="px-3 py-2">
                    {user.email ?? "–"}
                    {user.banned && (
                      <Badge variant="destructive" className="ml-2">
                        gesperrt
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">{user.name ?? "–"}</td>
                  <td className="px-3 py-2">{user.role ?? "–"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{user.created_at ?? "–"}</td>
                  <td className="px-3 py-2 text-right">
                    <CloudConfirmButton
                      label="Löschen"
                      variant="ghost"
                      icon={<Trash2 className="size-3.5" />}
                      busy={busy}
                      title="Nutzer löschen?"
                      confirmLabel="Löschen"
                      destructive
                      description={
                        <span>
                          {user.email ?? user.id} wird mit allen Sitzungen aus Neon Auth gelöscht.
                          Das kann nicht rückgängig gemacht werden.
                        </span>
                      }
                      onConfirm={() =>
                        void run(
                          () => neonAuthDeleteUser(accountId, projectId, branchId, user.id, true),
                          "Nutzer gelöscht",
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {users.data && (offset > 0 || users.data.has_more) && (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={offset === 0 || users.isFetching}
            onClick={() => setOffset((current) => Math.max(0, current - PAGE))}
          >
            Zurück
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!users.data.has_more || users.isFetching}
            onClick={() => setOffset((current) => current + PAGE)}
          >
            Weiter
          </Button>
        </div>
      )}
    </div>
  );
}

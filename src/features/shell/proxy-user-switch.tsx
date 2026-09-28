import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserRoundCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { connectionError } from "@/lib/connection-url";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { listProxyUsers, testConnectionString } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useCapabilities } from "@/lib/providers";
import { effectiveConnectionString } from "@/lib/ssh";
import { getTransactionForConnection } from "@/lib/transactions";
import { cn } from "@/lib/utils";
import { ProxyUserSwitchOptions } from "./proxy-user-switch-options";

const HINTS: Partial<Record<string, string>> = {
  postgres:
    "Setzt die Rolle für alle Verbindungen (SET ROLE). Rechte und RLS-Policies der Rolle greifen; Rollen mit BYPASSRLS oder Tabellen-Owner sehen weiterhin alles.",
  mssql:
    "Wechselt den Sicherheitskontext per EXECUTE AS LOGIN (Fallback EXECUTE AS USER). Erfordert IMPERSONATE-Recht; Security Policies greifen.",
  oracle:
    "Proxy-Anmeldung als benutzer[ziel]. Erfordert ALTER USER ziel GRANT CONNECT THROUGH benutzer; VPD-Policies greifen.",
  snowflake:
    "Wechselt die aktive Rolle für alle Abfragen dieser Verbindung. Die Rolle muss dem Benutzer gewährt sein.",
};

export function ProxyUserSwitch() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const caps = useCapabilities(connection?.kind);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const enabled = open && Boolean(connection) && caps.proxy_user;
  const candidates = useQuery({
    queryKey: ["proxy-users", connection?.id, database],
    queryFn: () =>
      listProxyUsers(
        connection!.kind,
        effectiveConnectionString({ ...connection!, proxyUser: null }),
        database ?? undefined,
      ),
    enabled,
  });

  if (!connection || !caps.proxy_user) return null;
  const active = connection.proxyUser?.trim() || null;
  const roleSwitch = connection.kind === "snowflake";
  const title = active
    ? roleSwitch
      ? `Rolle ${active}`
      : `Ansicht als ${active}`
    : roleSwitch
      ? "Rolle wechseln"
      : "Als Benutzer ansehen";

  async function apply(proxyUser: string | null) {
    if (!connection || busy) return;
    if (getTransactionForConnection(connection.id)) {
      toast.error("Schließe zuerst die offene Transaktion ab.");
      return;
    }
    const next = { ...connection, proxyUser };
    setBusy(true);
    try {
      await testConnectionString(next.kind, effectiveConnectionString(next));
      useConnectionsStore.setState((state) => ({
        connections: state.connections.map((entry) =>
          entry.id === next.id ? { ...entry, proxyUser } : entry,
        ),
      }));
      queryClient.removeQueries({ predicate: (query) => query.queryKey[1] === next.id });
      setOpen(false);
      toast.success(
        proxyUser
          ? roleSwitch
            ? `Rolle ${proxyUser} aktiv`
            : `Ansicht als ${proxyUser}`
          : roleSwitch
            ? "Wieder mit Standardrolle"
            : "Wieder mit eigenem Benutzer",
      );
    } catch (error) {
      toast.error(connectionError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={title}
          title={title}
          className={cn(
            "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full text-xs font-medium transition-colors",
            active
              ? "border border-violet-500/60 bg-violet-500/10 px-2.5 text-violet-700 dark:text-violet-300"
              : "w-7 justify-center text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <UserRoundCog className="size-3.5" />
          {active && (
            <span className="max-w-32 truncate @max-[14rem]/header-search:sr-only">{active}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-0">
        <div className="space-y-1 border-b p-3">
          <p className="font-medium">{roleSwitch ? "Rolle wechseln" : "Als Benutzer ansehen"}</p>
          <p className="text-xs text-muted-foreground">{HINTS[connection.kind]}</p>
        </div>
        {open && (
          <ProxyUserSwitchOptions
            kind={connection.kind}
            active={active}
            search={search}
            onSearch={setSearch}
            busy={busy}
            users={candidates.data ?? []}
            loading={candidates.isLoading}
            error={candidates.isError ? candidates.error : null}
            onApply={(user) => void apply(user)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { UserRoundCog, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { connectionError } from "@/lib/connection-url";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { testConnectionString } from "@/lib/db";
import { useCapabilities } from "@/lib/providers";
import { useRolesQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { getTransactionForConnection } from "@/lib/transactions";
import { cn } from "@/lib/utils";

const HINTS: Partial<Record<string, string>> = {
  postgres:
    "Setzt die Rolle für alle Verbindungen (SET ROLE). Rechte und RLS-Policies der Rolle greifen; Rollen mit BYPASSRLS oder Tabellen-Owner sehen weiterhin alles.",
  mssql:
    "Wechselt den Sicherheitskontext per EXECUTE AS LOGIN (Fallback EXECUTE AS USER). Erfordert IMPERSONATE-Recht; Security Policies greifen.",
  oracle:
    "Proxy-Anmeldung als benutzer[ziel]. Erfordert ALTER USER ziel GRANT CONNECT THROUGH benutzer; VPD-Policies greifen.",
};

export function ProxyUserSwitch() {
  const connection = useActiveConnection();
  const caps = useCapabilities(connection?.kind);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const roles = useRolesQuery(open && caps.proxy_user);

  if (!connection || !caps.proxy_user) return null;
  const active = connection.proxyUser?.trim() || null;

  async function apply(proxyUser: string | null) {
    if (!connection) return;
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
      toast.success(proxyUser ? `Ansicht als ${proxyUser}` : "Wieder mit eigenem Benutzer");
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
        if (next) setValue(active ?? "");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={active ? `Ansicht als ${active}` : "Als Benutzer ansehen"}
          title={active ? `Ansicht als ${active}` : "Als Benutzer ansehen"}
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
      <PopoverContent align="start" className="w-80 gap-3">
        <div className="space-y-1">
          <p className="font-medium">Als Benutzer ansehen</p>
          <p className="text-xs text-muted-foreground">{HINTS[connection.kind]}</p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) void apply(value.trim());
          }}
        >
          <Input
            autoFocus
            list="proxy-user-roles"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Benutzer / Rolle"
            aria-label="Proxy-Benutzer"
            className="h-8"
          />
          <datalist id="proxy-user-roles">
            {roles.data?.map((role) => (
              <option
                key={role.name}
                value={role.name}
                label={role.superuser || role.bypass_rls ? "umgeht RLS" : undefined}
              />
            ))}
          </datalist>
          <Button type="submit" size="sm" disabled={busy || !value.trim()}>
            Übernehmen
          </Button>
        </form>
        {active && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void apply(null)}>
            <X className="size-3.5" />
            Als {active} beenden
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

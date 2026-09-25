import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownLeft, UserRoundCog, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { connectionError } from "@/lib/connection-url";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { listProxyUsers, type ProxyUserInfo, testConnectionString } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useCapabilities } from "@/lib/providers";
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
  snowflake:
    "Wechselt die aktive Rolle für alle Abfragen dieser Verbindung. Die Rolle muss dem Benutzer gewährt sein.",
};

const GROUP_LABELS: Record<string, Record<ProxyUserInfo["category"], string>> = {
  postgres: { login: "Logins", user: "Benutzer", role: "Rollen" },
  mssql: { login: "Logins", user: "Datenbank-Benutzer", role: "Rollen" },
  oracle: { login: "Logins", user: "Freigegebene Benutzer", role: "Rollen" },
  snowflake: { login: "Logins", user: "Benutzer", role: "Rollen" },
};

const CATEGORIES: ProxyUserInfo["category"][] = ["login", "user", "role"];

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
  const typed = search.trim();
  const users = candidates.data ?? [];
  const labels = GROUP_LABELS[connection.kind] ?? GROUP_LABELS.postgres;
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
        <Command>
          <CommandInput
            autoFocus
            value={search}
            onValueChange={setSearch}
            placeholder="Benutzer oder Rolle suchen…"
            aria-label="Proxy-Benutzer suchen"
            disabled={busy}
          />
          <CommandList className="max-h-72">
            {active && (
              <CommandGroup>
                <CommandItem
                  value="__reset"
                  keywords={["beenden"]}
                  onSelect={() => void apply(null)}
                >
                  <X />
                  {roleSwitch ? `Rolle ${active} verlassen` : `Als ${active} beenden`}
                </CommandItem>
              </CommandGroup>
            )}
            {candidates.isLoading && (
              <p className="py-4 text-center text-xs text-muted-foreground">Lade Benutzer…</p>
            )}
            {candidates.isError && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Liste nicht verfügbar: {connectionError(candidates.error)}
              </p>
            )}
            <CommandEmpty>Keine Treffer.</CommandEmpty>
            {CATEGORIES.map((category) => {
              const entries = users.filter((user) => user.category === category);
              if (!entries.length) return null;
              return (
                <CommandGroup key={category} heading={labels[category]}>
                  {entries.map((user) => (
                    <CommandItem
                      key={user.name}
                      value={user.name}
                      data-checked={user.name === active}
                      disabled={busy}
                      onSelect={() => void apply(user.name)}
                    >
                      <span className="truncate">{user.name}</span>
                      {user.bypasses_rls && (
                        <span className="ml-auto shrink-0 rounded bg-amber-500/10 px-1.5 text-[10px] text-amber-700 dark:text-amber-400">
                          umgeht RLS
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
            {typed && !users.some((user) => user.name === typed) && (
              <CommandGroup heading="Eigene Eingabe">
                <CommandItem
                  forceMount
                  value={`__custom ${typed}`}
                  disabled={busy}
                  onSelect={() => void apply(typed)}
                >
                  <CornerDownLeft />„{typed}“ übernehmen
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

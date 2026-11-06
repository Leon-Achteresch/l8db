import { useQuery } from "@tanstack/react-query";
import { Play, Plug, Table2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CLOUD_QUERY_OPTIONS,
  type CloudAccount,
  type SpacetimeReducer,
  spacetimeCreateConnection,
  spacetimeDatabases,
  spacetimeSchema,
} from "@/lib/db/cloud-accounts";
import { addCloudConnection, cloudErrorText } from "./add-cloud-connection";
import { CloudSectionError } from "./cloud-section-error";
import { SpacetimeReducerDialog } from "./spacetime-reducer-dialog";

export function SpacetimeAccountExplorer({ account }: { account: CloudAccount }) {
  const [database, setDatabase] = useState<string | null>(null);
  const [reducer, setReducer] = useState<SpacetimeReducer | null>(null);
  const [busy, setBusy] = useState(false);
  const scope = ["cloud-accounts", account.id, "spacetime"] as const;
  const databases = useQuery({
    queryKey: [...scope, "databases"],
    queryFn: () => spacetimeDatabases(account.id),
    ...CLOUD_QUERY_OPTIONS,
  });
  const schema = useQuery({
    queryKey: [...scope, database, "schema"],
    queryFn: () => spacetimeSchema(account.id, database ?? ""),
    enabled: Boolean(database),
    ...CLOUD_QUERY_OPTIONS,
  });

  async function connect(name: string) {
    setBusy(true);
    try {
      addCloudConnection(await spacetimeCreateConnection(account.id, name, `SpacetimeDB ${name}`));
    } catch (reason) {
      toast.error(cloudErrorText(reason));
    } finally {
      setBusy(false);
    }
  }

  const tables = schema.data?.tables.filter((table) => !table.system) ?? [];
  const reducers = schema.data?.reducers.filter((entry) => !entry.lifecycle) ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium uppercase text-muted-foreground">Datenbanken</h3>
        <p className="break-all text-xs text-muted-foreground">
          Identität {account.identity ?? "–"}
          {account.endpoint ? ` · ${account.endpoint}` : " · Maincloud"}
        </p>
        {databases.isError && (
          <CloudSectionError error={databases.error} onRetry={() => void databases.refetch()} />
        )}
        {databases.isLoading && <p className="text-sm text-muted-foreground">Lade…</p>}
        {databases.data?.databases.map((entry) => {
          const name = entry.names[0] ?? entry.identity;
          return (
            <Button
              key={entry.identity}
              size="sm"
              variant={database === name ? "secondary" : "ghost"}
              className="justify-start"
              onClick={() => setDatabase(name)}
            >
              <span className="truncate">
                {entry.names[0] ?? `${entry.identity.slice(0, 16)}…`}
              </span>
            </Button>
          );
        })}
        {databases.data?.databases.length === 0 && (
          <p className="text-sm text-muted-foreground">Für diese Identität gibt es keine Module.</p>
        )}
        {databases.data?.truncated && (
          <p className="text-xs text-muted-foreground">
            Nur die ersten 100 Datenbanken werden angezeigt.
          </p>
        )}
      </section>
      <section className="flex min-w-0 flex-col gap-4">
        {!database && (
          <p className="text-sm text-muted-foreground">
            Datenbank wählen, um Tabellen und Reducer zu sehen.
          </p>
        )}
        {database && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{database}</h3>
              <Button size="sm" disabled={busy} onClick={() => void connect(database)}>
                <Plug className="size-3.5" />
                Als lesende Verbindung anlegen
              </Button>
            </div>
            {schema.isError && (
              <CloudSectionError error={schema.error} onRetry={() => void schema.refetch()} />
            )}
            {schema.isLoading && <p className="text-sm text-muted-foreground">Lade Schema…</p>}
            {schema.data && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground">Tabellen</h4>
                  <ul className="divide-y rounded-md border text-sm">
                    {tables.map((table) => (
                      <li key={table.name} className="flex flex-col gap-1 px-3 py-2">
                        <span className="flex items-center gap-2 font-medium">
                          <Table2 className="size-3.5" />
                          {table.name}
                          {!table.public && <Badge variant="outline">privat</Badge>}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {table.columns
                            .map((column) => `${column.name}: ${column.type_name}`)
                            .join(", ")}
                        </span>
                      </li>
                    ))}
                    {tables.length === 0 && (
                      <li className="px-3 py-4 text-center text-muted-foreground">
                        Keine Tabellen.
                      </li>
                    )}
                  </ul>
                </div>
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground">Reducer</h4>
                  <ul className="divide-y rounded-md border text-sm">
                    {reducers.map((entry) => (
                      <li key={entry.name} className="flex items-center gap-2 px-3 py-2">
                        <span className="flex-1 truncate">
                          {entry.name}(
                          {entry.params
                            .map((param) => `${param.name}: ${param.type_name}`)
                            .join(", ")}
                          )
                        </span>
                        <Button size="sm" variant="outline" onClick={() => setReducer(entry)}>
                          <Play className="size-3.5" />
                          Aufrufen
                        </Button>
                      </li>
                    ))}
                    {reducers.length === 0 && (
                      <li className="px-3 py-4 text-center text-muted-foreground">
                        Keine Reducer.
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </section>
      {database && reducer && (
        <SpacetimeReducerDialog
          accountId={account.id}
          database={database}
          reducer={reducer}
          open={Boolean(reducer)}
          onOpenChange={(open) => {
            if (!open) setReducer(null);
          }}
        />
      )}
    </div>
  );
}

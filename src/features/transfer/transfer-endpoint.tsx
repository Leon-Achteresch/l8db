import { DatabaseIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { connectionSummary, providerFor } from "@/lib/connection-url";
import { useConnectionsStore, visibleSchemas } from "@/lib/connections";
import { listDatabases, listSchemas } from "@/lib/db";
import { databaseFromConnectionString } from "@/lib/db-selection";
import { useConnectionEnvironment } from "@/lib/environments";
import { capabilitiesFor } from "@/lib/providers";
import { prepareConnection } from "@/lib/schema-compare/store";
import { effectiveConnectionString } from "@/lib/ssh";
import type { TransferSide } from "./transfer-view/use-transfer";

export function TransferEndpoint({
  title,
  value,
  onChange,
  onSchemas,
  badge,
}: {
  title: string;
  badge?: ReactNode;
  value: TransferSide;
  onChange: (value: TransferSide) => void;
  onSchemas: (schemas: string[]) => void;
}) {
  const connections = useConnectionsStore((state) => state.connections);
  const usable = connections.filter((item) => capabilitiesFor(item.kind).table_copy);
  const connection = usable.find((item) => item.id === value.connectionId) ?? null;
  const withDatabases = Boolean(connection && capabilitiesFor(connection.kind).databases);
  const [databases, setDatabases] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectionId = connection?.id ?? null;
  const database = value.database;
  const environment = useConnectionEnvironment(connection);

  useEffect(() => {
    onSchemas([]);
    setError(null);
    if (!connectionId) {
      setDatabases([]);
      return;
    }
    let active = true;
    setLoading(true);
    prepareConnection(connectionId)
      .then(async (ready) => {
        const url = effectiveConnectionString(ready);
        const [dbs, schemas] = await Promise.all([
          capabilitiesFor(ready.kind).databases ? listDatabases(ready.kind, url) : [],
          listSchemas(ready.kind, url, database ?? undefined),
        ]);
        if (!active) return;
        setDatabases(dbs);
        onSchemas(visibleSchemas(ready, schemas));
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [connectionId, database, onSchemas]);

  const pickConnection = (id: string) => {
    const picked = connections.find((item) => item.id === id);
    onChange({
      connectionId: id,
      database: picked ? databaseFromConnectionString(effectiveConnectionString(picked)) : null,
    });
  };

  const summary = connection
    ? connectionSummary(connection.connectionString, connection.kind)
    : null;
  const provider = connection ? providerFor(connection) : null;
  const where = summary
    ? summary.host && summary.port
      ? `${summary.host}:${summary.port}`
      : summary.database || summary.host
    : "";

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl border bg-card px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="w-12 shrink-0 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </span>
        <Select value={value.connectionId ?? ""} onValueChange={pickConnection}>
          <SelectTrigger
            className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-1.5 text-sm font-semibold shadow-none hover:bg-muted dark:bg-transparent dark:hover:bg-muted/60"
            aria-label={`${title}: Verbindung`}
          >
            <SelectValue placeholder="Verbindung wählen" />
          </SelectTrigger>
          <SelectContent searchable>
            {usable.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                <ProviderLogo
                  providerId={providerFor(item).id}
                  kind={item.kind}
                  className="size-3.5"
                />
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {environment && (
          <span
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
            style={{ color: environment.color, backgroundColor: `${environment.color}1f` }}
          >
            {environment.label}
          </span>
        )}
        {badge}
        {loading && <Spinner className="size-3 shrink-0 text-muted-foreground" />}
      </div>
      <div className="flex min-w-0 items-center gap-2 pl-15">
        {connection ? (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {[where, provider?.name].filter(Boolean).join(" · ")}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Keine Verbindung gewählt</span>
        )}
        {withDatabases && (
          <Select
            value={value.database ?? ""}
            onValueChange={(next) => onChange({ ...value, database: next })}
            disabled={databases.length === 0}
          >
            <SelectTrigger
              size="sm"
              className="ml-auto h-7 w-auto max-w-48 min-w-0 shrink-0 text-xs"
              aria-label={`${title}: Datenbank`}
            >
              <SelectValue placeholder="Datenbank" />
            </SelectTrigger>
            <SelectContent searchable>
              {databases.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  <DatabaseIcon className="size-3.5 text-muted-foreground" />
                  {entry}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {error && <p className="pl-15 text-xs text-destructive">{error}</p>}
    </div>
  );
}

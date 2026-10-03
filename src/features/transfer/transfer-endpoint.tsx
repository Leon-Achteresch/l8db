import { DatabaseIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { providerFor } from "@/lib/connection-url";
import { useConnectionsStore, visibleSchemas } from "@/lib/connections";
import { listDatabases, listSchemas } from "@/lib/db";
import { databaseFromConnectionString } from "@/lib/db-selection";
import { capabilitiesFor } from "@/lib/providers";
import { prepareConnection } from "@/lib/schema-compare/store";
import { effectiveConnectionString } from "@/lib/ssh";
import type { TransferSide } from "./transfer-view/use-transfer";

export function TransferEndpoint({
  title,
  value,
  onChange,
  onSchemas,
}: {
  title: string;
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

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex h-4 items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {loading && <Spinner className="size-3 text-muted-foreground" />}
      </div>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <Select value={value.connectionId ?? ""} onValueChange={pickConnection}>
          <SelectTrigger
            className="h-9 min-w-0 flex-1 rounded-xl"
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
        {withDatabases && (
          <Select
            value={value.database ?? ""}
            onValueChange={(next) => onChange({ ...value, database: next })}
            disabled={databases.length === 0}
          >
            <SelectTrigger
              className="h-9 min-w-0 flex-1 rounded-xl"
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
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

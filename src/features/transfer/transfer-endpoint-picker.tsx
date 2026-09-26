import { DatabaseIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { providerFor } from "@/lib/connection-url";
import { useConnectionsStore, visibleSchemas } from "@/lib/connections";
import { listDatabases, listSchemas } from "@/lib/db";
import { databaseFromConnectionString } from "@/lib/db-selection";
import { capabilitiesFor } from "@/lib/providers";
import { prepareConnection } from "@/lib/schema-compare/store";
import { effectiveConnectionString } from "@/lib/ssh";
import type { TransferSide } from "./transfer-view/use-transfer";

interface Lists {
  key: string;
  databases: string[];
  schemas: string[];
}

export function TransferEndpointPicker({
  title,
  value,
  onChange,
  children,
}: {
  title: string;
  value: TransferSide;
  onChange: (value: TransferSide) => void;
  children: (schemas: string[], loading: boolean) => ReactNode;
}) {
  const connections = useConnectionsStore((state) => state.connections);
  const usable = connections.filter((item) => capabilitiesFor(item.kind).table_copy);
  const connection = usable.find((item) => item.id === value.connectionId) ?? null;
  const withDatabases = Boolean(connection && capabilitiesFor(connection.kind).databases);
  const [lists, setLists] = useState<Lists | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectionId = connection?.id ?? null;
  const key = connectionId ? `${connectionId}|${value.database ?? ""}` : null;
  const loaded = lists && lists.key === key ? lists : null;

  useEffect(() => {
    if (!connectionId || !key) return;
    let active = true;
    setLoading(true);
    setError(null);
    prepareConnection(connectionId)
      .then(async (ready) => {
        const url = effectiveConnectionString(ready);
        const [databases, schemas] = await Promise.all([
          capabilitiesFor(ready.kind).databases ? listDatabases(ready.kind, url) : [],
          listSchemas(ready.kind, url, value.database ?? undefined),
        ]);
        if (active) setLists({ key, databases, schemas: visibleSchemas(ready, schemas) });
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
  }, [connectionId, key, value.database]);

  const pickConnection = (id: string) => {
    const picked = connections.find((item) => item.id === id);
    onChange({
      connectionId: id,
      database: picked ? databaseFromConnectionString(effectiveConnectionString(picked)) : null,
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-muted/30 p-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </span>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Verbindung</Label>
        <Select value={value.connectionId ?? ""} onValueChange={pickConnection}>
          <SelectTrigger className="h-8 w-full min-w-0 text-xs" aria-label={`${title}: Verbindung`}>
            <SelectValue placeholder="Verbindung wählen" />
          </SelectTrigger>
          <SelectContent searchable>
            {usable.map((item) => (
              <SelectItem key={item.id} value={item.id} className="text-xs">
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
      </div>
      {withDatabases && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Datenbank</Label>
          <Select
            value={value.database ?? ""}
            onValueChange={(database) => onChange({ ...value, database })}
            disabled={(loaded?.databases.length ?? 0) === 0}
          >
            <SelectTrigger
              className="h-8 w-full min-w-0 text-xs"
              aria-label={`${title}: Datenbank`}
            >
              <SelectValue placeholder="Datenbank wählen" />
            </SelectTrigger>
            <SelectContent searchable>
              {(loaded?.databases ?? []).map((database) => (
                <SelectItem key={database} value={database} className="text-xs">
                  <DatabaseIcon className="size-3.5 text-muted-foreground" />
                  {database}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {connection && children(loaded?.schemas ?? [], loading)}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

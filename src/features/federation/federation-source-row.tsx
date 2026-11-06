import { useQuery } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useConnectionsStore } from "@/lib/connections";
import { type FederationSource, federationCatalog } from "@/lib/db/federation";
import { FederationNameField } from "./federation-name-field";

const EMPTY: string[] = [];

export function FederationSourceRow({
  source,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  source: FederationSource;
  index: number;
  disabled: boolean;
  onChange: (source: FederationSource) => void;
  onRemove: () => void;
}) {
  const connections = useConnectionsStore((state) => state.connections);
  const options = useMemo(
    () =>
      connections.filter(
        (connection) => !connection.temporary && !connection.vault && connection.kind !== "s3",
      ),
    [connections],
  );
  const ids = useMemo(() => options.map((connection) => connection.id), [options]);
  const labels = useMemo(
    () => new Map(options.map((connection) => [connection.id, connection.name])),
    [options],
  );
  const display = useCallback((id: string) => labels.get(id) ?? id, [labels]);
  const [lookup, setLookup] = useState(source);
  useEffect(() => {
    const timer = setTimeout(() => setLookup(source), 250);
    return () => clearTimeout(timer);
  }, [source]);
  const metadata = useQuery({
    queryKey: ["federation", "catalog", lookup.connectionId, lookup.database, lookup.schema],
    queryFn: ({ signal }) =>
      federationCatalog(lookup.connectionId, lookup.database, lookup.schema, signal),
    enabled: Boolean(lookup.connectionId) && !disabled,
    staleTime: 60_000,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const tables = useMemo(
    () => metadata.data?.tables.map((table) => table.name) ?? EMPTY,
    [metadata.data],
  );
  const prefix = `Quelle ${index + 1}`;

  return (
    <fieldset
      className="grid min-w-0 grid-cols-2 items-start gap-2 rounded-xl border p-3 lg:grid-cols-[100px_minmax(150px,1.3fr)_minmax(110px,1fr)_minmax(110px,1fr)_minmax(140px,1fr)_32px]"
      disabled={disabled}
      aria-label={prefix}
    >
      <Input
        aria-label={`${prefix}: Alias`}
        value={source.alias}
        maxLength={32}
        placeholder="Alias"
        onChange={(event) => onChange({ ...source, alias: event.target.value })}
      />
      <FederationNameField
        label={`${prefix}: Verbindung`}
        value={source.connectionId}
        options={ids}
        display={display}
        disabled={disabled}
        allowCustom={false}
        onChange={(connectionId) =>
          onChange({ ...source, connectionId, database: null, schema: "", table: "" })
        }
      />
      <FederationNameField
        label={`${prefix}: Datenbank`}
        value={source.database ?? ""}
        options={metadata.data?.databases ?? EMPTY}
        disabled={disabled || !source.connectionId}
        onChange={(database) =>
          onChange({ ...source, database: database || null, schema: "", table: "" })
        }
      />
      <FederationNameField
        label={`${prefix}: Schema`}
        value={source.schema}
        options={metadata.data?.schemas ?? EMPTY}
        disabled={disabled || !source.connectionId}
        onChange={(schema) => onChange({ ...source, schema, table: "" })}
      />
      <FederationNameField
        label={`${prefix}: Tabelle`}
        value={source.table}
        options={tables}
        disabled={disabled || !source.schema}
        onChange={(table) => onChange({ ...source, table })}
      />
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`${prefix} entfernen`}
        onClick={onRemove}
        disabled={disabled}
      >
        <Trash2Icon className="size-3.5" />
      </Button>
      {metadata.isFetching && (
        <span
          role="status"
          className="col-span-full flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Spinner className="size-3" />
          Quellstruktur wird geladen…
        </span>
      )}
      {metadata.isError && (
        <p role="alert" className="col-span-full text-xs text-destructive">
          {String(metadata.error)}
        </p>
      )}
      {metadata.data?.hasMore && (
        <p className="col-span-full text-xs text-muted-foreground">
          Die Vorschlagsliste ist auf 5.000 Namen begrenzt. Weitere Datenbanken, Schemas und
          Tabellen können direkt eingegeben werden.
        </p>
      )}
    </fieldset>
  );
}

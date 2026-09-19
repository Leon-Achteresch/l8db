import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useObjectGrantsQuery } from "@/lib/queries";

export function TableGrantsPanel({ schema, name }: { schema: string; name: string }) {
  const { data, isLoading, isError, error, isFetching, refetch } = useObjectGrantsQuery(
    schema,
    name,
  );
  const [filter, setFilter] = useState("");
  const term = filter.trim().toLowerCase();
  const grants = (data ?? []).filter((grant) =>
    [grant.grantee, grant.privilege, grant.grantor, grant.column_name ?? ""].some((value) =>
      value.toLowerCase().includes(term),
    ),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          Grants · {schema}.{name} · {data?.length ?? 0}
        </span>
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Grants filtern…"
          aria-label="Grants filtern"
          className="ml-auto h-7 w-44 text-xs"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Grants aktualisieren"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
      </div>
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">
        Für die aktive Verbindung sichtbare Objekt- und Spalten-Grants.
      </p>
      {isLoading ? (
        <div
          role="status"
          className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner /> Lade Grants…
        </div>
      ) : isError ? (
        <p role="alert" className="p-6 text-center text-sm text-destructive">
          {String(error)}
        </p>
      ) : grants.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          {data?.length ? "Keine Treffer für diesen Filter." : "Keine sichtbaren Grants vorhanden."}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
              <tr>
                {["Empfänger", "Privileg", "Grantor", "Grant Option", "Spalte"].map((label) => (
                  <th key={label} scope="col" className="border-b px-4 py-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grants.map((grant, index) => (
                <tr
                  key={JSON.stringify([
                    grant.grantee,
                    grant.privilege,
                    grant.grantor,
                    grant.column_name,
                    index,
                  ])}
                  className="border-b hover:bg-muted/30"
                >
                  <td className="px-4 py-2 font-mono">{grant.grantee}</td>
                  <td className="px-4 py-2 font-mono">{grant.privilege}</td>
                  <td className="px-4 py-2 font-mono">{grant.grantor}</td>
                  <td className="px-4 py-2">{grant.grantable ? "Ja" : "Nein"}</td>
                  <td className="px-4 py-2 font-mono">{grant.column_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

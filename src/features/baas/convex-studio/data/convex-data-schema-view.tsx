import { useQuery } from "@tanstack/react-query";
import { Copy, Wand2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { copyWithToast } from "@/lib/clipboard";
import { type ConvexDataSchema, convexDataInferSchema } from "@/lib/db/convex-studio-data";
import type { ConvexStudioDeployment } from "../convex-studio-sections";
import { dataKey, schemaFields, tableIndexes, validatorText } from "./convex-data-utils";

export function ConvexDataSchemaView({
  deployment,
  table,
  schema,
  loading,
  error,
}: {
  deployment: ConvexStudioDeployment;
  table: string;
  schema: ConvexDataSchema | undefined;
  loading: boolean;
  error: unknown;
}) {
  const schemaTable = schema?.tables.find((item) => item.tableName === table);
  const fields = schemaFields(schemaTable);
  const [generate, setGenerate] = useState(false);
  const inferred = useQuery({
    queryKey: [...dataKey(deployment), "infer", table],
    queryFn: () => convexDataInferSchema(deployment, table),
    enabled: generate || (!loading && !fields),
    staleTime: 60_000,
  });
  const { all } = tableIndexes(schema?.indexes ?? [], table);

  if (loading) return <p className="text-xs text-muted-foreground">Schema wird geladen…</p>;
  if (error)
    return (
      <p role="alert" className="text-xs text-destructive">
        {String(error)}
      </p>
    );

  return (
    <div className="grid gap-5">
      <section className="grid gap-2">
        <h3 className="text-sm font-medium">Deploytes Schema</h3>
        {!schema?.has_schema ? (
          <p className="text-xs text-muted-foreground">
            Das Deployment hat kein Schema (keine schema.ts gepusht).
          </p>
        ) : !schemaTable ? (
          <p className="text-xs text-muted-foreground">
            Die Tabelle ist nicht im Schema definiert.
          </p>
        ) : !fields ? (
          <p className="text-xs text-muted-foreground">
            Dokumenttyp:{" "}
            <span className="font-mono">{validatorText(schemaTable.documentType)}</span>
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-left text-xs">
              <caption className="sr-only">Felder von {table}</caption>
              <thead className="bg-muted/50">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Feld
                  </th>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Typ
                  </th>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Optional
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(fields).map(([name, field]) => (
                  <tr key={name} className="border-t">
                    <td className="px-3 py-1.5 font-mono">{name}</td>
                    <td className="px-3 py-1.5 font-mono break-all">
                      {validatorText(field.fieldType)}
                    </td>
                    <td className="px-3 py-1.5">{field.optional ? "ja" : "nein"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {schema?.has_schema && (
          <p className="text-[11px] text-muted-foreground">
            Schema-Validierung {schema.schema_validation ? "aktiv" : "deaktiviert"}.
          </p>
        )}
      </section>
      <section className="grid gap-2">
        <h3 className="text-sm font-medium">Indizes</h3>
        {all.length === 0 ? (
          <p className="text-xs text-muted-foreground">Keine Indizes außer den Standardindizes.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-left text-xs">
              <caption className="sr-only">Indizes von {table}</caption>
              <thead className="bg-muted/50">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Art
                  </th>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Felder
                  </th>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {all.map((index) => {
                  const spec = index.fields;
                  const [kind, detail] = Array.isArray(spec)
                    ? ["Datenbank", spec.join(", ")]
                    : "searchField" in spec
                      ? [
                          "Volltext",
                          `Suche: ${spec.searchField}${spec.filterFields.length ? ` · Filter: ${spec.filterFields.join(", ")}` : ""}`,
                        ]
                      : [
                          "Vektor",
                          `${spec.vectorField} (${spec.dimensions} Dim.)${spec.filterFields.length ? ` · Filter: ${spec.filterFields.join(", ")}` : ""}`,
                        ];
                  return (
                    <tr key={index.name} className="border-t">
                      <td className="px-3 py-1.5 font-mono">{index.name}</td>
                      <td className="px-3 py-1.5">{kind}</td>
                      <td className="px-3 py-1.5 font-mono">{detail}</td>
                      <td className="px-3 py-1.5">
                        {index.backfill?.state === "done"
                          ? "bereit"
                          : (index.backfill?.state ?? "–")}
                        {index.staged ? " · gestaged" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="grid gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Aus Daten generiertes Schema</h3>
          {inferred.data && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Generiertes Schema kopieren"
              onClick={() => void copyWithToast(inferred.data, "Schema")}
            >
              <Copy />
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Abgeleitet aus den neuesten 200 Dokumenten, als Vorlage für schema.ts.
        </p>
        {!inferred.data && !inferred.isFetching && !inferred.isError ? (
          <div>
            <Button variant="outline" size="sm" onClick={() => setGenerate(true)}>
              <Wand2 className="size-3.5" /> Generieren
            </Button>
          </div>
        ) : inferred.isFetching && !inferred.data ? (
          <p className="text-xs text-muted-foreground">Wird generiert…</p>
        ) : inferred.isError ? (
          <p role="alert" className="text-xs text-destructive">
            {String(inferred.error)}
          </p>
        ) : (
          <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs">
            {`${table}: ${inferred.data}`}
          </pre>
        )}
      </section>
    </div>
  );
}

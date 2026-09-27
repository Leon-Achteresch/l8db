import { useQuery } from "@tanstack/react-query";
import { Archive, ChevronLeft, ChevronRight, Database, File, RefreshCw, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { pocketbaseCollections, pocketbaseRecords } from "@/lib/db";

function displayValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value || "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function PocketBaseCollectionsView({ id }: { id: string }) {
  const [collectionPage, setCollectionPage] = useState(1);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [recordPage, setRecordPage] = useState(1);
  const collections = useQuery({
    queryKey: ["pocketbase", id, "collections", collectionPage],
    queryFn: () => pocketbaseCollections(id, collectionPage),
  });
  const selected =
    collections.data?.items.find((item) => item.id === collectionId) ?? collections.data?.items[0];
  const records = useQuery({
    queryKey: ["pocketbase", id, "records", selected?.id, recordPage],
    queryFn: () => {
      if (!selected) throw new Error("Keine Collection gewählt.");
      return pocketbaseRecords(id, selected.id, recordPage);
    },
    enabled: Boolean(selected),
  });
  const fileFields =
    selected?.fields.filter((field) => field.kind === "file" && !field.hidden) ?? [];

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <Database className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Collections</h3>
        {collections.data && (
          <span className="ml-auto text-xs text-muted-foreground">
            {collections.data.total_items}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Collections aktualisieren"
          onClick={() => void collections.refetch()}
          disabled={collections.isFetching}
        >
          <RefreshCw className={`size-3.5 ${collections.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {collections.isPending ? (
        <p className="mt-5 text-xs text-muted-foreground">Collections werden geladen…</p>
      ) : collections.isError ? (
        <p role="alert" className="mt-5 text-xs text-destructive">
          {String(collections.error)}
        </p>
      ) : collections.data.items.length === 0 ? (
        <p className="mt-5 text-xs text-muted-foreground">Keine Collections vorhanden.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {collections.data.items.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected?.id === item.id}
                onClick={() => {
                  setCollectionId(item.id);
                  setRecordPage(1);
                }}
                className={`rounded-lg border px-2.5 py-1.5 text-xs ${selected?.id === item.id ? "border-primary/50 bg-primary/10" : "bg-background hover:bg-muted"}`}
              >
                {item.name}
                {item.kind === "auth" && (
                  <Users className="ml-1 inline size-3 text-muted-foreground" />
                )}
              </button>
            ))}
          </div>
          {collections.data.total_pages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Vorherige Collections"
                disabled={collectionPage === 1}
                onClick={() => {
                  setCollectionPage((value) => value - 1);
                  setCollectionId(null);
                  setRecordPage(1);
                }}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground">
                {collectionPage} / {collections.data.total_pages}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Weitere Collections"
                disabled={collectionPage >= collections.data.total_pages}
                onClick={() => {
                  setCollectionPage((value) => value + 1);
                  setCollectionId(null);
                  setRecordPage(1);
                }}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          )}
          <div className="mt-5 border-t pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold">{selected?.name}</h4>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                {selected?.kind === "auth" ? "Auth" : "Daten"}
              </span>
              <span className="text-xs text-muted-foreground">
                {selected?.fields.length ?? 0} Felder
              </span>
              {fileFields.length > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Archive className="size-3" /> {fileFields.length} Dateifelder
                </span>
              )}
              {records.data && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {records.data.total_items} Datensätze
                </span>
              )}
            </div>
            {records.isPending ? (
              <p className="mt-4 text-xs text-muted-foreground">Datensätze werden geladen…</p>
            ) : records.isError ? (
              <p role="alert" className="mt-4 text-xs text-destructive">
                {String(records.error)}
              </p>
            ) : records.data.items.length === 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">Keine Datensätze vorhanden.</p>
            ) : (
              <div className="mt-4 divide-y">
                {records.data.items.map((record) => {
                  const title = [record.name, record.title, record.email].find(
                    (value) => typeof value === "string" && value.length > 0,
                  );
                  const attachments = fileFields.flatMap((field) => {
                    const value = record[field.name];
                    if (typeof value === "string" && value)
                      return [{ field: field.name, name: value }];
                    if (Array.isArray(value))
                      return value
                        .filter((name): name is string => typeof name === "string")
                        .map((name) => ({ field: field.name, name }));
                    return [];
                  });
                  return (
                    <div key={record.id} className="py-3 first:pt-0">
                      <details className="group">
                        <summary className="cursor-pointer text-xs font-medium">
                          <span className="mr-2">
                            {typeof title === "string" ? title : record.id}
                          </span>
                          <span className="font-mono text-[10px] font-normal text-muted-foreground">
                            {record.id}
                          </span>
                        </summary>
                        <div className="mt-3 grid gap-2 rounded-xl bg-background/60 p-3 sm:grid-cols-2">
                          {selected?.fields
                            .filter(
                              (field) =>
                                !field.hidden && field.kind !== "file" && field.name !== "id",
                            )
                            .map((field) => (
                              <div key={field.name} className="min-w-0">
                                <p className="text-[10px] text-muted-foreground">{field.name}</p>
                                <p
                                  className="truncate text-xs"
                                  title={displayValue(record[field.name])}
                                >
                                  {displayValue(record[field.name])}
                                </p>
                              </div>
                            ))}
                        </div>
                      </details>
                      {attachments.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {attachments.map((file) => (
                            <span
                              key={`${file.field}:${file.name}`}
                              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-lg border bg-background px-2 py-1 text-[11px] text-muted-foreground"
                              title={`${file.field}: ${file.name}`}
                            >
                              <File className="size-3 shrink-0" />{" "}
                              <span className="truncate">{file.name}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {records.data && records.data.total_pages > 1 && (
              <div className="mt-4 flex items-center justify-end gap-2 border-t pt-3">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Vorherige Datensätze"
                  disabled={recordPage === 1}
                  onClick={() => setRecordPage((value) => value - 1)}
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground">
                  {recordPage} / {records.data.total_pages}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Weitere Datensätze"
                  disabled={recordPage >= records.data.total_pages}
                  onClick={() => setRecordPage((value) => value + 1)}
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

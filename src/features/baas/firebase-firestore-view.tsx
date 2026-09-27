import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Database, FileJson, Folder, RefreshCw } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  type FirebaseFirestoreDocument,
  firebaseFirestoreCollections,
  firebaseFirestoreDatabases,
  firebaseFirestoreDocuments,
} from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

function displayValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const field = value as Record<string, unknown>;
  if ("nullValue" in field) return null;
  for (const key of [
    "stringValue",
    "booleanValue",
    "doubleValue",
    "timestampValue",
    "referenceValue",
  ]) {
    if (key in field) return field[key];
  }
  if ("integerValue" in field) return field.integerValue;
  if ("bytesValue" in field) return `Base64: ${field.bytesValue}`;
  if ("geoPointValue" in field) return field.geoPointValue;
  if ("arrayValue" in field) {
    const array = field.arrayValue as { values?: unknown[] } | null;
    return array?.values?.map(displayValue) ?? [];
  }
  if ("mapValue" in field) {
    const map = field.mapValue as { fields?: Record<string, unknown> } | null;
    return Object.fromEntries(
      Object.entries(map?.fields ?? {}).map(([key, item]) => [key, displayValue(item)]),
    );
  }
  return value;
}

function documentPath(document: FirebaseFirestoreDocument): string {
  return document.name.split("/documents/")[1] ?? "";
}

export function FirebaseFirestoreView({ projectId }: { projectId: string }) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.firebase.firestore");
  const [selectedDatabase, setSelectedDatabase] = useState<string | null>(null);
  const [collectionPath, setCollectionPath] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<FirebaseFirestoreDocument | null>(null);
  const [collectionPages, setCollectionPages] = useState([""]);
  const [documentPages, setDocumentPages] = useState([""]);
  const databases = useQuery({
    queryKey: ["firebase", projectId, "firestore-databases"],
    queryFn: () => firebaseFirestoreDatabases(projectId),
  });
  const database =
    databases.data?.databases.find((item) => item.name === selectedDatabase) ??
    databases.data?.databases[0];
  const databaseId = database?.name.split("/").at(-1);
  const parentPath = selectedDocument ? documentPath(selectedDocument) : "";
  const collections = useQuery({
    queryKey: [
      "firebase",
      projectId,
      "firestore-collections",
      databaseId,
      parentPath,
      collectionPages.at(-1),
    ],
    queryFn: () =>
      firebaseFirestoreCollections(
        projectId,
        databaseId ?? "",
        parentPath,
        collectionPages.at(-1) || undefined,
      ),
    enabled: Boolean(databaseId) && (!collectionPath || Boolean(selectedDocument)),
  });
  const documents = useQuery({
    queryKey: [
      "firebase",
      projectId,
      "firestore-documents",
      databaseId,
      collectionPath,
      documentPages.at(-1),
    ],
    queryFn: () =>
      firebaseFirestoreDocuments(
        projectId,
        databaseId ?? "",
        collectionPath ?? "",
        documentPages.at(-1) || undefined,
      ),
    enabled: Boolean(databaseId && collectionPath),
  });

  function selectDatabase(name: string) {
    setSelectedDatabase(name);
    setCollectionPath(null);
    setSelectedDocument(null);
    setCollectionPages([""]);
    setDocumentPages([""]);
  }

  function openCollection(id: string) {
    setCollectionPath(parentPath ? `${parentPath}/${id}` : id);
    setSelectedDocument(null);
    setCollectionPages([""]);
    setDocumentPages([""]);
  }

  function goBack() {
    if (selectedDocument) {
      setSelectedDocument(null);
      setCollectionPages([""]);
      return;
    }
    if (collectionPath) {
      const segments = collectionPath.split("/");
      setCollectionPath(segments.length > 1 ? segments.slice(0, -2).join("/") : null);
      setDocumentPages([""]);
      setCollectionPages([""]);
    }
  }

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div ref={feature.ref} className="flex items-center gap-2">
          <Database className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Firestore</h3>
          {feature.isNew && <NewBadge />}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Firestore-Datenbanken aktualisieren"
          onClick={() => void databases.refetch()}
          disabled={databases.isFetching}
        >
          <RefreshCw className={`size-3.5 ${databases.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {databases.isPending ? (
        <p className="mt-4 text-xs text-muted-foreground">Datenbanken werden geladen…</p>
      ) : databases.isError ? (
        <p role="alert" className="mt-4 text-xs text-destructive">
          {String(databases.error)}
        </p>
      ) : databases.data.databases.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">Keine Firestore-Datenbank gefunden.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {databases.data.databases.map((item) => (
              <button
                key={item.name}
                type="button"
                aria-pressed={database?.name === item.name}
                onClick={() => selectDatabase(item.name)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs ${database?.name === item.name ? "border-primary/50 bg-primary/10" : "bg-background hover:bg-muted"}`}
              >
                {item.name.split("/").at(-1)}
              </button>
            ))}
          </div>
          {databases.data.unreachable.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {databases.data.unreachable.length} Datenbank(en) nicht erreichbar.
            </p>
          )}
          {database && (
            <>
              <p className="mt-3 text-xs text-muted-foreground">
                {[database.locationId, database.type].filter(Boolean).join(" · ")}
              </p>
              <div className="mt-4 border-t pt-4">
                <div className="flex min-w-0 items-center gap-2">
                  {(collectionPath || selectedDocument) && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Firestore zurück"
                      onClick={goBack}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                  )}
                  <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                    /{databaseId}/
                    {selectedDocument ? documentPath(selectedDocument) : (collectionPath ?? "")}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Firestore-Inhalt aktualisieren"
                    onClick={() =>
                      void (selectedDocument || !collectionPath ? collections : documents).refetch()
                    }
                    disabled={
                      selectedDocument || !collectionPath
                        ? collections.isFetching
                        : documents.isFetching
                    }
                  >
                    <RefreshCw className="size-3.5" />
                  </Button>
                </div>
                {selectedDocument && (
                  <div className="mt-4 rounded-xl border bg-background/50 p-3">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <FileJson className="size-3.5" /> {selectedDocument.name.split("/").at(-1)}
                    </div>
                    {!selectedDocument.createTime && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Übergeordnetes Dokument ohne eigene Daten
                      </p>
                    )}
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Aktualisiert:{" "}
                      {selectedDocument.updateTime
                        ? new Date(selectedDocument.updateTime).toLocaleString("de-DE")
                        : "Nicht angegeben"}
                    </p>
                    <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed">
                      {JSON.stringify(
                        Object.fromEntries(
                          Object.entries(selectedDocument.fields).map(([key, value]) => [
                            key,
                            displayValue(value),
                          ]),
                        ),
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                )}
                {(!collectionPath || selectedDocument) &&
                  (collections.isPending ? (
                    <p className="mt-4 text-xs text-muted-foreground">
                      Kollektionen werden geladen…
                    </p>
                  ) : collections.isError ? (
                    <p role="alert" className="mt-4 text-xs text-destructive">
                      {String(collections.error)}
                    </p>
                  ) : (
                    <>
                      <p className="mt-4 text-xs font-medium">
                        {selectedDocument ? "Unterkollektionen" : "Kollektionen"}
                      </p>
                      {collections.data.collectionIds.length === 0 ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Keine Kollektionen auf dieser Seite.
                        </p>
                      ) : (
                        <div className="mt-2 divide-y">
                          {collections.data.collectionIds.map((id) => (
                            <button
                              key={id}
                              type="button"
                              className="flex w-full items-center gap-2 py-2 text-left text-xs hover:text-primary"
                              onClick={() => openCollection(id)}
                            >
                              <Folder className="size-3.5 shrink-0 text-primary" />
                              <span className="min-w-0 flex-1 truncate">{id}</span>
                              <ChevronRight className="size-3.5 shrink-0" />
                            </button>
                          ))}
                        </div>
                      )}
                      {(collectionPages.length > 1 || collections.data.nextPageToken) && (
                        <div className="mt-3 flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={collectionPages.length === 1}
                            onClick={() => setCollectionPages((pages) => pages.slice(0, -1))}
                          >
                            <ChevronLeft className="size-3.5" /> Zurück
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!collections.data.nextPageToken}
                            onClick={() => {
                              const nextPageToken = collections.data.nextPageToken;
                              if (nextPageToken)
                                setCollectionPages((pages) => [...pages, nextPageToken]);
                            }}
                          >
                            Weiter <ChevronRight className="size-3.5" />
                          </Button>
                        </div>
                      )}
                    </>
                  ))}
                {collectionPath &&
                  (documents.isPending ? (
                    <p className="mt-4 text-xs text-muted-foreground">Dokumente werden geladen…</p>
                  ) : documents.isError ? (
                    <p role="alert" className="mt-4 text-xs text-destructive">
                      {String(documents.error)}
                    </p>
                  ) : (
                    <>
                      <p className="mt-4 text-xs font-medium">Dokumente</p>
                      {documents.data.documents.length === 0 ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Keine Dokumente auf dieser Seite.
                        </p>
                      ) : (
                        <div className="mt-2 divide-y">
                          {documents.data.documents.map((document) => (
                            <button
                              key={document.name}
                              type="button"
                              aria-pressed={selectedDocument?.name === document.name}
                              className="flex w-full items-center gap-2 py-2 text-left text-xs hover:text-primary"
                              onClick={() => {
                                setSelectedDocument(document);
                                setCollectionPages([""]);
                              }}
                            >
                              <FileJson className="size-3.5 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate">
                                {document.name.split("/").at(-1)}
                              </span>
                              {!document.createTime && (
                                <span className="shrink-0 text-muted-foreground">
                                  Nur Unterkollektionen
                                </span>
                              )}
                              <ChevronRight className="size-3.5 shrink-0" />
                            </button>
                          ))}
                        </div>
                      )}
                      {(documentPages.length > 1 || documents.data.nextPageToken) && (
                        <div className="mt-3 flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={documentPages.length === 1}
                            onClick={() => {
                              setDocumentPages((pages) => pages.slice(0, -1));
                              setSelectedDocument(null);
                            }}
                          >
                            <ChevronLeft className="size-3.5" /> Zurück
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!documents.data.nextPageToken}
                            onClick={() => {
                              const nextPageToken = documents.data.nextPageToken;
                              if (nextPageToken) {
                                setDocumentPages((pages) => [...pages, nextPageToken]);
                                setSelectedDocument(null);
                              }
                            }}
                          >
                            Weiter <ChevronRight className="size-3.5" />
                          </Button>
                        </div>
                      )}
                    </>
                  ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

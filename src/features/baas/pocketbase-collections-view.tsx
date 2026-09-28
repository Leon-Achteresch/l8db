import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Database,
  File,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  pocketbaseCollections,
  pocketbaseCreateRecord,
  pocketbaseDeleteFile,
  pocketbaseDeleteRecord,
  pocketbaseDownloadFile,
  pocketbasePreviewFile,
  pocketbaseRecords,
  pocketbaseUpdateRecord,
  pocketbaseUploadFile,
} from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasFilePreview } from "./baas-file-preview";

function displayValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value || "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function PocketBaseCollectionsView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const manageFeature = useNewFeatureVisibility<HTMLDivElement>("baas.pocketbase.manage");
  const [collectionPage, setCollectionPage] = useState(1);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [recordPage, setRecordPage] = useState(1);
  const [preview, setPreview] = useState<{
    collectionId: string;
    recordId: string;
    name: string;
  } | null>(null);
  const [editor, setEditor] = useState<{ recordId: string | null; draft: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    collectionId: string;
    recordId: string;
  } | null>(null);
  const [fileDeleteTarget, setFileDeleteTarget] = useState<{
    collectionId: string;
    recordId: string;
    field: string;
    filename: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
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

  async function saveRecord() {
    if (!selected || !editor || busy) return;
    let data: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(editor.draft);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("JSON-Objekt erwartet.");
      }
      data = parsed as Record<string, unknown>;
    } catch (reason) {
      setActionError(`Ungültiges JSON: ${String(reason)}`);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      if (editor.recordId) {
        await pocketbaseUpdateRecord(id, selected.id, editor.recordId, data);
        setActionSuccess("Datensatz aktualisiert.");
      } else {
        await pocketbaseCreateRecord(id, selected.id, data);
        setActionSuccess("Datensatz erstellt.");
      }
      setEditor(null);
      setRecordPage(1);
      await queryClient.invalidateQueries({ queryKey: ["pocketbase", id, "records", selected.id] });
    } catch (reason) {
      setActionError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function deleteRecord() {
    if (!deleteTarget || busy) return;
    const target = deleteTarget;
    setBusy(true);
    setActionError(null);
    try {
      await pocketbaseDeleteRecord(id, target.collectionId, target.recordId);
      setDeleteTarget(null);
      setEditor(null);
      setPreview(null);
      setActionSuccess("Datensatz gelöscht.");
      setRecordPage(1);
      await queryClient.invalidateQueries({
        queryKey: ["pocketbase", id, "records", target.collectionId],
      });
    } catch (reason) {
      setActionError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(collectionId: string, recordId: string, fieldName: string) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const uploaded = await pocketbaseUploadFile(id, collectionId, recordId, fieldName);
      if (uploaded) {
        setPreview(null);
        setActionSuccess("Datei hochgeladen.");
        await queryClient.invalidateQueries({
          queryKey: ["pocketbase", id, "records", collectionId],
        });
      }
    } catch (reason) {
      setActionError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function deleteFile() {
    if (!fileDeleteTarget || busy) return;
    const target = fileDeleteTarget;
    setBusy(true);
    setActionError(null);
    try {
      await pocketbaseDeleteFile(
        id,
        target.collectionId,
        target.recordId,
        target.field,
        target.filename,
      );
      setFileDeleteTarget(null);
      setPreview(null);
      setActionSuccess("Datei gelöscht.");
      await queryClient.invalidateQueries({
        queryKey: ["pocketbase", id, "records", target.collectionId],
      });
    } catch (reason) {
      setActionError(String(reason));
    } finally {
      setBusy(false);
    }
  }

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
      {actionError && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {actionError}
        </p>
      )}
      {actionSuccess && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {actionSuccess}
        </p>
      )}
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
                  setPreview(null);
                  setEditor(null);
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
                  setPreview(null);
                  setEditor(null);
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
                  setPreview(null);
                  setEditor(null);
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
              {selected && (
                <div ref={manageFeature.ref} className="ml-auto flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditor({ recordId: null, draft: "{}" });
                      setActionError(null);
                    }}
                  >
                    <Plus className="size-3.5" /> Datensatz erstellen
                  </Button>
                  {manageFeature.isNew && <NewBadge />}
                </div>
              )}
            </div>
            {editor && (
              <div className="mt-4 rounded-xl border bg-background/60 p-3">
                <p className="text-xs font-medium">
                  {editor.recordId
                    ? `Datensatz ${editor.recordId} bearbeiten`
                    : "Datensatz erstellen"}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Sichtbare Felder als JSON-Objekt eingeben. Dateifelder werden unten separat
                  verwaltet.
                </p>
                <Textarea
                  aria-label="Datensatzfelder als JSON"
                  className="mt-3 min-h-36 font-mono text-xs"
                  value={editor.draft}
                  onChange={(event) => setEditor({ ...editor, draft: event.target.value })}
                  disabled={busy}
                />
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => void saveRecord()} disabled={busy}>
                    {busy ? "Speichert…" : "Speichern"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditor(null)} disabled={busy}>
                    Abbrechen
                  </Button>
                </div>
              </div>
            )}
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
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const data = Object.fromEntries(
                                selected?.fields
                                  .filter(
                                    (field) =>
                                      !field.hidden &&
                                      field.kind !== "file" &&
                                      field.name in record,
                                  )
                                  .map((field) => [field.name, record[field.name]]) ?? [],
                              );
                              setEditor({
                                recordId: record.id,
                                draft: JSON.stringify(data, null, 2),
                              });
                              setActionError(null);
                            }}
                          >
                            <Pencil className="size-3.5" /> Bearbeiten
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (selected)
                                setDeleteTarget({ collectionId: selected.id, recordId: record.id });
                            }}
                          >
                            <Trash2 className="size-3.5" /> Löschen
                          </Button>
                          {selected &&
                            fileFields.map((field) => (
                              <Button
                                key={field.name}
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void uploadFile(selected.id, record.id, field.name)}
                              >
                                <Upload className="size-3.5" /> {field.name}
                              </Button>
                            ))}
                        </div>
                      </details>
                      {attachments.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {attachments.map((file) => (
                            <div
                              key={`${file.field}:${file.name}`}
                              className="inline-flex min-w-0 max-w-full items-center rounded-lg border bg-background text-[11px] text-muted-foreground"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  if (selected)
                                    setPreview({
                                      collectionId: selected.id,
                                      recordId: record.id,
                                      name: file.name,
                                    });
                                }}
                                className="inline-flex min-w-0 items-center gap-1 px-2 py-1 hover:text-primary"
                                title={`${file.field}: ${file.name}`}
                              >
                                <File className="size-3 shrink-0" />{" "}
                                <span className="truncate">{file.name}</span>
                              </button>
                              {selected && (
                                <button
                                  type="button"
                                  aria-label={`${file.name} löschen`}
                                  className="px-2 py-1 hover:text-destructive"
                                  onClick={() =>
                                    setFileDeleteTarget({
                                      collectionId: selected.id,
                                      recordId: record.id,
                                      field: file.field,
                                      filename: file.name,
                                    })
                                  }
                                >
                                  <Trash2 className="size-3" />
                                </button>
                              )}
                            </div>
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
                  onClick={() => {
                    setRecordPage((value) => value - 1);
                    setPreview(null);
                  }}
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
                  onClick={() => {
                    setRecordPage((value) => value + 1);
                    setPreview(null);
                  }}
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            )}
            {preview && preview.collectionId === selected?.id && (
              <BaasFilePreview
                key={`${preview.collectionId}:${preview.recordId}:${preview.name}`}
                name={preview.name}
                queryKey={[
                  "pocketbase",
                  id,
                  "preview",
                  preview.collectionId,
                  preview.recordId,
                  preview.name,
                ]}
                load={() =>
                  pocketbasePreviewFile(id, preview.collectionId, preview.recordId, preview.name)
                }
                download={() =>
                  pocketbaseDownloadFile(id, preview.collectionId, preview.recordId, preview.name)
                }
                onClose={() => setPreview(null)}
              />
            )}
          </div>
        </>
      )}
      <AlertDialog
        open={deleteTarget !== null || fileDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDeleteTarget(null);
            setFileDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {fileDeleteTarget ? "Datei endgültig löschen?" : "Datensatz endgültig löschen?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {fileDeleteTarget
                ? `${fileDeleteTarget.filename} wird aus dem Datensatz entfernt.`
                : `Datensatz ${deleteTarget?.recordId} und seine Dateien werden gelöscht.`}{" "}
              Dieser Vorgang kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void (fileDeleteTarget ? deleteFile() : deleteRecord());
              }}
            >
              {busy ? "Löscht…" : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

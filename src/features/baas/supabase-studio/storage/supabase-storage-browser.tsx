import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  File,
  Folder,
  FolderPlus,
  MoveRight,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { SupabaseBucket } from "@/lib/db";
import {
  supabaseStudioStorageCreateFolder,
  supabaseStudioStorageDelete,
  supabaseStudioStorageObjects,
  supabaseStudioStorageUpload,
} from "@/lib/db/supabase-studio-storage";
import { formatBytes, formatDate, storageQueryKey, validStorageName } from "./storage-format";
import { SupabaseStorageConfirmDialog } from "./supabase-storage-confirm-dialog";
import { SupabaseStorageObjectPanel } from "./supabase-storage-object-panel";
import { SupabaseStorageTransferDialog } from "./supabase-storage-transfer-dialog";

const PAGE = 100;

export function SupabaseStorageBrowser({
  reference,
  bucket,
}: {
  reference: string;
  bucket: SupabaseBucket;
}) {
  const queryClient = useQueryClient();
  const [prefix, setPrefix] = useState("");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<{ source: string; copy: boolean } | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [upsert, setUpsert] = useState(false);
  const [busy, setBusy] = useState(false);
  const objects = useQuery({
    queryKey: storageQueryKey(reference, "objects", bucket.id, prefix, search, offset),
    queryFn: () => supabaseStudioStorageObjects(reference, bucket.id, prefix, search, offset),
    placeholderData: keepPreviousData,
  });
  const segments = prefix.split("/").filter(Boolean);
  const rows = objects.data?.objects ?? [];
  const pathOf = (name: string, folder: boolean) => `${prefix}${name}${folder ? "/" : ""}`;
  const allSelected =
    rows.length > 0 && rows.every((row) => selected.has(pathOf(row.name, !row.id)));

  function open(next: string) {
    setPrefix(next);
    setDraft("");
    setSearch("");
    setOffset(0);
    setSelected(new Set());
    setActive(null);
  }

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: storageQueryKey(reference, "objects", bucket.id),
    });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  const upload = () =>
    run(async () => {
      const result = await supabaseStudioStorageUpload(reference, bucket.id, prefix, upsert);
      if (result.uploaded.length) toast.success(`${result.uploaded.length} Datei(en) hochgeladen.`);
      for (const failure of result.failed) toast.error(`${failure.name}: ${failure.error}`);
    });

  const createFolder = (name: string) =>
    run(async () => {
      if (!validStorageName(name))
        throw new Error("Bitte einen Ordnernamen ohne Schrägstrich eingeben.");
      const folder = await supabaseStudioStorageCreateFolder(reference, bucket.id, prefix, name);
      setFolderName(null);
      open(folder);
    });

  const remove = (paths: string[]) =>
    run(async () => {
      const count = await supabaseStudioStorageDelete(reference, bucket.id, paths);
      toast.success(`${count} Datei(en) gelöscht.`);
      setDeleting(null);
      setSelected(new Set());
      if (active && paths.includes(active)) setActive(null);
    });

  function toggle(path: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  }

  const singleSelection = selected.size === 1 ? [...selected][0] : null;

  return (
    <div className="space-y-3">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            {segments.length ? (
              <BreadcrumbLink asChild>
                <button type="button" onClick={() => open("")}>
                  {bucket.name}
                </button>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage>{bucket.name}</BreadcrumbPage>
            )}
          </BreadcrumbItem>
          {segments.map((segment, index) => (
            <Fragment key={segments.slice(0, index + 1).join("/")}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {index === segments.length - 1 ? (
                  <BreadcrumbPage>{segment}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <button
                      type="button"
                      onClick={() => open(`${segments.slice(0, index + 1).join("/")}/`)}
                    >
                      {segment}
                    </button>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-40 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(draft.trim());
            setOffset(0);
            setSelected(new Set());
          }}
        >
          <Search className="pointer-events-none absolute top-2.5 left-2 size-3.5 text-muted-foreground" />
          <Input
            className="h-8 pl-7 text-xs"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="In diesem Ordner suchen (Namensanfang)"
            aria-label="Dateien suchen"
          />
        </form>
        <Button size="sm" variant="outline" onClick={() => void upload()} disabled={busy}>
          <Upload className="size-3.5" /> Hochladen
        </Button>
        <div className="flex items-center gap-1.5">
          <Switch id="storage-upsert" size="sm" checked={upsert} onCheckedChange={setUpsert} />
          <Label htmlFor="storage-upsert" className="text-xs">
            Überschreiben
          </Label>
        </div>
        <Button size="sm" variant="outline" onClick={() => setFolderName("")} disabled={busy}>
          <FolderPlus className="size-3.5" /> Ordner
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dateien aktualisieren"
          onClick={() => void objects.refetch()}
          disabled={objects.isFetching}
        >
          <RefreshCw className={`size-3.5 ${objects.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {folderName !== null && (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void createFolder(folderName.trim());
          }}
        >
          <Input
            autoFocus
            className="h-8 max-w-xs text-xs"
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder="Ordnername"
            aria-label="Neuer Ordnername"
            disabled={busy}
          />
          <Button size="sm" type="submit" disabled={busy}>
            Erstellen
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setFolderName(null)}>
            Abbrechen
          </Button>
        </form>
      )}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 text-xs">
          <span>{selected.size} ausgewählt</span>
          {singleSelection && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTransfer({ source: singleSelection, copy: false })}
              >
                <MoveRight className="size-3.5" /> Verschieben
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTransfer({ source: singleSelection, copy: true })}
              >
                <Copy className="size-3.5" /> Kopieren
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setDeleting([...selected])}>
            <Trash2 className="size-3.5" /> Löschen
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Auswahl aufheben
          </Button>
        </div>
      )}
      <div className={`grid gap-4 ${active ? "xl:grid-cols-[minmax(0,1fr)_340px]" : ""}`}>
        <div className="min-w-0 overflow-x-auto rounded-xl border">
          {objects.isPending ? (
            <p className="p-4 text-xs text-muted-foreground">Dateien werden geladen…</p>
          ) : objects.isError ? (
            <p role="alert" className="p-4 text-xs text-destructive">
              {String(objects.error)}
            </p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              {search ? "Keine passenden Dateien." : "Dieser Ordner ist leer."}
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="border-b bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <Checkbox
                      aria-label="Alle auswählen"
                      checked={allSelected}
                      onCheckedChange={(checked) =>
                        setSelected(
                          checked
                            ? new Set(rows.map((row) => pathOf(row.name, !row.id)))
                            : new Set(),
                        )
                      }
                    />
                  </th>
                  <th className="w-full px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Größe</th>
                  <th className="px-2 py-2 font-medium">Typ</th>
                  <th className="px-2 py-2 font-medium">Geändert</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => {
                  const folder = !row.id;
                  const path = pathOf(row.name, folder);
                  return (
                    <tr
                      key={path}
                      className={active === path ? "bg-primary/5" : "hover:bg-muted/40"}
                    >
                      <td className="px-3 py-1.5">
                        <Checkbox
                          aria-label={`${row.name} auswählen`}
                          checked={selected.has(path)}
                          onCheckedChange={(checked) => toggle(path, checked === true)}
                        />
                      </td>
                      <td className="max-w-0 px-2 py-1.5">
                        <button
                          type="button"
                          className="flex w-full min-w-0 items-center gap-2 text-left hover:text-primary"
                          onClick={() => (folder ? open(path) : setActive(path))}
                          title={row.name}
                        >
                          {folder ? (
                            <Folder className="size-3.5 shrink-0 text-primary" />
                          ) : (
                            <File className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate">{row.name}</span>
                        </button>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                        {folder ? "" : formatBytes(row.metadata?.size)}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                        {folder
                          ? "Ordner"
                          : typeof row.metadata?.mimetype === "string"
                            ? row.metadata.mimetype
                            : ""}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                        {folder ? "" : formatDate(row.updated_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {objects.data && (offset > 0 || objects.data.has_more) && (
            <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => {
                  setOffset((value) => Math.max(0, value - PAGE));
                  setSelected(new Set());
                }}
              >
                <ChevronLeft className="size-3" /> Zurück
              </Button>
              <span className="text-xs text-muted-foreground">
                {offset + 1}–{offset + rows.length}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={!objects.data.has_more}
                onClick={() => {
                  setOffset((value) => value + PAGE);
                  setSelected(new Set());
                }}
              >
                Weiter <ChevronRight className="size-3" />
              </Button>
            </div>
          )}
        </div>
        {active && (
          <SupabaseStorageObjectPanel
            key={active}
            reference={reference}
            bucket={bucket}
            objectKey={active}
            onTransfer={(copy) => setTransfer({ source: active, copy })}
            onDelete={() => setDeleting([active])}
            onClose={() => setActive(null)}
          />
        )}
      </div>
      {transfer && (
        <SupabaseStorageTransferDialog
          reference={reference}
          bucket={bucket.id}
          source={transfer.source}
          copy={transfer.copy}
          onClose={() => setTransfer(null)}
          onDone={() => {
            if (!transfer.copy && active === transfer.source) setActive(null);
            setTransfer(null);
            setSelected(new Set());
            void queryClient.invalidateQueries({ queryKey: storageQueryKey(reference, "objects") });
          }}
        />
      )}
      <SupabaseStorageConfirmDialog
        open={deleting !== null}
        title={`${deleting?.length ?? 0} ${deleting?.length === 1 ? "Eintrag" : "Einträge"} endgültig löschen?`}
        description={`${(deleting ?? []).slice(0, 5).join(", ")}${(deleting?.length ?? 0) > 5 ? " …" : ""} wird gelöscht. Ordner werden mit allen enthaltenen Dateien gelöscht. Dieser Vorgang kann nicht rückgängig gemacht werden.`}
        action="Löschen"
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={() => deleting && void remove(deleting)}
      />
    </div>
  );
}

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type ConvexFilesOrder,
  type ConvexStoredFile,
  convexStudioFilesCount,
  convexStudioFilesDelete,
  convexStudioFilesDownload,
  convexStudioFilesGet,
  convexStudioFilesList,
  convexStudioFilesPreview,
  convexStudioFilesUpload,
} from "@/lib/db/convex-studio-files";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasFilePreview } from "../../baas-file-preview";
import { SupabaseStorageConfirmDialog } from "../../supabase-studio/storage/supabase-storage-confirm-dialog";
import type { ConvexStudioSectionProps } from "../convex-studio-sections";
import { ConvexFilesTable } from "./convex-files-table";

function dayBoundary(value: string, end: boolean): number | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  if (end) date.setDate(date.getDate() + 1);
  return date.getTime() - (end ? 1 : 0);
}

export function ConvexFilesSection({ deployment }: ConvexStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.convex.studio.files");
  const queryClient = useQueryClient();
  const baseKey = [
    "convex",
    deployment.profileId,
    deployment.projectId,
    deployment.deploymentName,
    "files",
  ];
  const [order, setOrder] = useState<ConvexFilesOrder>("desc");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<ConvexStoredFile | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const cursor = cursors[cursors.length - 1];
  const minCreationTime = dayBoundary(from, false);
  const maxCreationTime = dayBoundary(to, true);

  const count = useQuery({
    queryKey: [...baseKey, "count"],
    queryFn: () => convexStudioFilesCount(deployment),
  });
  const page = useQuery({
    queryKey: [...baseKey, "page", order, minCreationTime, maxCreationTime, cursor],
    queryFn: () =>
      convexStudioFilesList(deployment, cursor, order, minCreationTime, maxCreationTime),
    placeholderData: keepPreviousData,
    enabled: !search,
  });
  const found = useQuery({
    queryKey: [...baseKey, "get", search],
    queryFn: () => convexStudioFilesGet(deployment, search),
    enabled: Boolean(search),
  });
  const current = search ? found : page;
  const files = search ? (found.data ? [found.data] : []) : (page.data?.files ?? []);

  function resetPaging() {
    setCursors([null]);
    setSelected(new Set());
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: baseKey });
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  const upload = () =>
    run(async () => {
      const result = await convexStudioFilesUpload(deployment);
      if (result.uploaded.length) {
        toast.success(`${result.uploaded.length} Datei(en) hochgeladen.`);
        resetPaging();
      }
      for (const failure of result.failed) toast.error(`${failure.name}: ${failure.error}`);
    });

  const remove = (ids: string[]) =>
    run(async () => {
      const removed = await convexStudioFilesDelete(deployment, ids);
      toast.success(`${removed} Datei(en) gelöscht.`);
      setDeleting(null);
      setSelected(new Set());
      if (active && ids.includes(active.id)) setActive(null);
    });

  async function download(file: ConvexStoredFile) {
    try {
      if (await convexStudioFilesDownload(deployment, file.id)) toast.success("Datei gespeichert.");
    } catch (reason) {
      toast.error(String(reason));
    }
  }

  function toggle(id: string, checked: boolean) {
    setSelected((value) => {
      const next = new Set(value);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 ref={feature.ref} className="flex items-center gap-2 text-lg font-semibold">
            Dateien {feature.isNew && <NewBadge />}
          </h2>
          <p className="text-xs text-muted-foreground">
            {count.data === undefined
              ? "Dateispeicher des Deployments"
              : `${count.data.toLocaleString("de-DE")} Datei(en) im Dateispeicher`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void upload()} disabled={busy}>
            <Upload className="size-3.5" /> Hochladen
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dateien aktualisieren"
            onClick={() => void queryClient.invalidateQueries({ queryKey: baseKey })}
            disabled={current.isFetching}
          >
            <RefreshCw className={`size-3.5 ${current.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-48 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(draft.trim());
            resetPaging();
          }}
        >
          <Search className="pointer-events-none absolute top-2.5 left-2 size-3.5 text-muted-foreground" />
          <Input
            className="h-8 pr-8 pl-7 font-mono text-xs"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Storage-ID suchen und Enter drücken"
            aria-label="Storage-ID suchen"
          />
          {search && (
            <button
              type="button"
              aria-label="Suche zurücksetzen"
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setDraft("");
                setSearch("");
              }}
            >
              <X className="size-3.5" />
            </button>
          )}
        </form>
        <Select
          value={order}
          onValueChange={(value) => {
            setOrder(value as ConvexFilesOrder);
            resetPaging();
          }}
          disabled={Boolean(search)}
        >
          <SelectTrigger size="sm" className="h-8 w-40 text-xs" aria-label="Sortierung">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Neueste zuerst</SelectItem>
            <SelectItem value="asc">Älteste zuerst</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="date"
          className="h-8 w-36 text-xs"
          aria-label="Erstellt ab"
          value={from}
          disabled={Boolean(search)}
          onChange={(event) => {
            setFrom(event.target.value);
            resetPaging();
          }}
        />
        <Input
          type="date"
          className="h-8 w-36 text-xs"
          aria-label="Erstellt bis"
          value={to}
          disabled={Boolean(search)}
          onChange={(event) => {
            setTo(event.target.value);
            resetPaging();
          }}
        />
      </div>
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 text-xs">
          <span>{selected.size} ausgewählt</span>
          <Button size="sm" variant="ghost" onClick={() => setDeleting([...selected])}>
            <Trash2 className="size-3.5" /> Löschen
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Auswahl aufheben
          </Button>
        </div>
      )}
      <div className={`grid gap-4 ${active ? "xl:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
        <div className="min-w-0 overflow-x-auto rounded-xl border">
          {current.isPending ? (
            <p className="p-4 text-xs text-muted-foreground">Dateien werden geladen…</p>
          ) : current.isError ? (
            <p role="alert" className="p-4 text-xs text-destructive">
              {String(current.error)}
            </p>
          ) : files.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              {search ? "Keine Datei mit dieser Storage-ID." : "Keine Dateien gespeichert."}
            </p>
          ) : (
            <ConvexFilesTable
              files={files}
              selected={selected}
              active={active?.id ?? null}
              onToggle={toggle}
              onToggleAll={(checked) =>
                setSelected(checked ? new Set(files.map((file) => file.id)) : new Set())
              }
              onPreview={setActive}
              onDownload={(file) => void download(file)}
              onDelete={(file) => setDeleting([file.id])}
            />
          )}
          {!search && page.data && (cursors.length > 1 || page.data.hasMore) && (
            <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
              <Button
                size="sm"
                variant="outline"
                disabled={cursors.length === 1}
                onClick={() => {
                  setCursors((value) => value.slice(0, -1));
                  setSelected(new Set());
                }}
              >
                <ChevronLeft className="size-3" /> Zurück
              </Button>
              <span className="text-xs text-muted-foreground">Seite {cursors.length}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={!page.data.hasMore || !page.data.cursor || page.isPlaceholderData}
                onClick={() => {
                  const next = page.data?.cursor ?? null;
                  setCursors((value) => [...value, next]);
                  setSelected(new Set());
                }}
              >
                Weiter <ChevronRight className="size-3" />
              </Button>
            </div>
          )}
        </div>
        {active && (
          <BaasFilePreview
            key={active.id}
            name={active.id}
            queryKey={[...baseKey, "preview", active.id]}
            load={() => convexStudioFilesPreview(deployment, active.id)}
            download={() => convexStudioFilesDownload(deployment, active.id)}
            onClose={() => setActive(null)}
            className="mt-0 self-start"
          />
        )}
      </div>
      <SupabaseStorageConfirmDialog
        open={deleting !== null}
        title="Dateien löschen?"
        description={`${deleting?.length ?? 0} Datei(en) werden endgültig aus dem Convex-Dateispeicher gelöscht. Dokumente, die diese Storage-IDs referenzieren, verweisen danach ins Leere.`}
        action="Löschen"
        busy={busy}
        onConfirm={() => deleting && void remove(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      />
    </div>
  );
}

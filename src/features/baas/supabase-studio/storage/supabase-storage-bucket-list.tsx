import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Globe2, Lock, Plus, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sidebarMenuButtonVariants } from "@/components/ui/sidebar/shared";
import type { SupabaseBucket } from "@/lib/db";
import {
  type SupabaseStorageBucketSettings,
  supabaseStudioStorageBucketCreate,
  supabaseStudioStorageBuckets,
} from "@/lib/db/supabase-studio-storage";
import { cn } from "@/lib/utils";
import { storageQueryKey } from "./storage-format";
import { SupabaseStorageBucketDialog } from "./supabase-storage-bucket-dialog";

const PAGE = 100;

export function SupabaseStorageBucketList({
  reference,
  selectedId,
  canManage,
  onSelect,
}: {
  reference: string;
  selectedId: string | null;
  canManage: boolean;
  onSelect: (bucket: SupabaseBucket) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const buckets = useQuery({
    queryKey: storageQueryKey(reference, "buckets", search, offset),
    queryFn: () => supabaseStudioStorageBuckets(reference, search, offset),
    placeholderData: keepPreviousData,
  });

  async function create(name: string, settings: SupabaseStorageBucketSettings) {
    setBusy(true);
    try {
      await supabaseStudioStorageBucketCreate(reference, name, settings);
      toast.success(`Bucket ${name} erstellt.`);
      setCreating(false);
      await queryClient.invalidateQueries({ queryKey: storageQueryKey(reference, "buckets") });
      onSelect({
        id: name,
        name,
        public: settings.public,
        created_at: null,
        updated_at: null,
        kind: null,
        file_size_limit: settings.fileSizeLimit,
        allowed_mime_types: settings.allowedMimeTypes.length ? settings.allowedMimeTypes : null,
      });
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-1">
        <form
          className="relative flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(draft.trim());
            setOffset(0);
          }}
        >
          <Search className="pointer-events-none absolute top-2.5 left-2 size-3.5 text-muted-foreground" />
          <Input
            className="h-8 pl-7 text-xs"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Buckets suchen"
            aria-label="Buckets suchen"
          />
        </form>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Buckets aktualisieren"
          onClick={() => void buckets.refetch()}
          disabled={buckets.isFetching}
        >
          <RefreshCw className={`size-3.5 ${buckets.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setCreating(true)}
        disabled={!canManage}
        title={
          canManage ? undefined : "Bucket-Verwaltung benötigt einen Secret oder service_role Key."
        }
      >
        <Plus className="size-3.5" /> Neuer Bucket
      </Button>
      {buckets.isPending ? (
        <p className="text-xs text-muted-foreground">Buckets werden geladen…</p>
      ) : buckets.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {String(buckets.error)}
        </p>
      ) : buckets.data.buckets.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {search ? "Keine passenden Buckets." : "Keine Buckets sichtbar."}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {buckets.data.buckets.map((bucket) => (
            <li key={bucket.id}>
              <button
                type="button"
                aria-current={bucket.id === selectedId ? "true" : undefined}
                onClick={() => onSelect(bucket)}
                data-active={bucket.id === selectedId || undefined}
                className={cn(sidebarMenuButtonVariants(), "text-xs")}
              >
                {bucket.public ? (
                  <Globe2 className="size-3.5 shrink-0 text-primary" aria-label="Öffentlich" />
                ) : (
                  <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Privat" />
                )}
                <span className="truncate" title={bucket.name}>
                  {bucket.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {buckets.data && (offset > 0 || buckets.data.has_more) && (
        <div className="flex items-center justify-between gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Vorherige Buckets"
            disabled={offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - PAGE))}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {offset + 1}–{offset + buckets.data.buckets.length}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Weitere Buckets"
            disabled={!buckets.data.has_more}
            onClick={() => setOffset((value) => value + PAGE)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
      {!canManage && (
        <form
          className="space-y-1.5 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            const name = manual.trim();
            if (!name) return;
            onSelect({
              id: name,
              name,
              public: false,
              created_at: null,
              updated_at: null,
              kind: null,
              file_size_limit: null,
              allowed_mime_types: null,
            });
          }}
        >
          <p className="text-[11px] text-muted-foreground">
            Mit Publishable/anon Key zeigt Supabase nur Buckets, die Richtlinien freigeben. Bekannte
            Buckets direkt öffnen:
          </p>
          <div className="flex gap-1">
            <Input
              className="h-8 text-xs"
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              placeholder="Bucket-Name"
              aria-label="Bucket-Name zum Öffnen"
            />
            <Button size="sm" type="submit" variant="outline">
              Öffnen
            </Button>
          </div>
        </form>
      )}
      {creating && (
        <SupabaseStorageBucketDialog
          open
          bucket={null}
          busy={busy}
          onOpenChange={setCreating}
          onSubmit={(name, settings) => void create(name, settings)}
        />
      )}
    </div>
  );
}

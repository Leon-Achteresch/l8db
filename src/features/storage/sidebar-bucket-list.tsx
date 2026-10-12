import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArchiveIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { CopyAsMenu } from "@/components/copy-as-menu";
import { IconButton } from "@/components/icon-button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { SidebarQueryError } from "@/features/sidebar/sidebar-query-error";
import { copyWithToast } from "@/lib/clipboard";
import { s3ListBuckets } from "@/lib/db";
import { useRouterSelect } from "@/lib/hooks/use-router-select";
import { formatMenuShortcut, MENU_KEYS, menuKeyHandler } from "@/lib/hotkeys";
import { usePaneTabTarget } from "@/lib/pane-tab-target";
import { useTableTabs } from "@/lib/table-tabs";
import { CreateBucketDialog } from "./create-bucket-dialog";
import { DeleteBucketDialog } from "./delete-bucket-dialog";
import { formatDate, useStorageConnection } from "./use-storage-connection";

export function SidebarBucketList() {
  const { connection, url, readOnly } = useStorageConnection();
  const navigate = useNavigate();
  const target = usePaneTabTarget();
  const [filter, setFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const pathname = useRouterSelect((state) => state.location.pathname);
  const buckets = useQuery({
    queryKey: ["s3", connection?.id, "buckets"],
    queryFn: () => s3ListBuckets(url),
    enabled: Boolean(connection && url),
  });

  function open(bucket: string) {
    if (target) {
      target.open({ kind: "bucket", bucket });
      return;
    }
    useTableTabs.getState().openBucketTab({ bucket });
    void navigate({ to: "/buckets/$bucket", params: { bucket } });
  }

  const needle = filter.trim().toLowerCase();
  const items = (buckets.data ?? []).filter((b) => b.name.toLowerCase().includes(needle));

  return (
    <div className="flex flex-col gap-2">
      <div className="sticky top-0 z-10 flex items-center gap-1 bg-sidebar py-1">
        <SidebarInput
          placeholder="Buckets…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Buckets filtern"
        />
        {!readOnly && (
          <IconButton
            size="icon-sm"
            variant="outline"
            className="shrink-0"
            aria-label="Bucket erstellen"
            onClick={() => setCreateOpen(true)}
          >
            <PlusIcon />
          </IconButton>
        )}
      </div>
      {buckets.isLoading ? (
        <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
          <Spinner />
          Lade Buckets…
        </div>
      ) : buckets.isError ? (
        <SidebarQueryError error={buckets.error} />
      ) : items.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">
          {buckets.data?.length ? "Keine Treffer." : "Keine Buckets vorhanden."}
        </p>
      ) : (
        <SidebarMenu>
          {items.map((bucket) => (
            <SidebarMenuItem key={bucket.name}>
              <ContextMenu>
                <ContextMenuTrigger
                  asChild
                  onKeyDown={menuKeyHandler({
                    copyName: () => void copyWithToast(bucket.name, "Name"),
                  })}
                >
                  <SidebarMenuButton
                    isActive={pathname === `/buckets/${encodeURIComponent(bucket.name)}`}
                    onClick={() => open(bucket.name)}
                    title={
                      bucket.creation_date
                        ? `Erstellt ${formatDate(bucket.creation_date)}`
                        : bucket.name
                    }
                    data-bucket={bucket.name}
                  >
                    <ArchiveIcon className="text-orange-500" />
                    <span className="truncate">{bucket.name}</span>
                  </SidebarMenuButton>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => open(bucket.name)}>
                    Öffnen
                    <ContextMenuShortcut>{formatMenuShortcut(MENU_KEYS.open)}</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <CopyAsMenu name={bucket.name} shortcuts>
                    <ContextMenuItem
                      onSelect={() => void copyWithToast(`s3://${bucket.name}/`, "S3-URI")}
                    >
                      S3-URI
                    </ContextMenuItem>
                  </CopyAsMenu>
                  {!readOnly && (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onSelect={() => setDeleteTarget(bucket.name)}
                      >
                        Bucket löschen…
                      </ContextMenuItem>
                    </>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      )}
      <CreateBucketDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={open} />
      <DeleteBucketDialog bucket={deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} />
    </div>
  );
}

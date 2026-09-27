import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TableDataError } from "@/features/table/table-data-error";
import { s3CreateFolder, s3RenameObject } from "@/lib/db";
import { setBucketDropHandler } from "@/lib/storage/drop-target";
import { basename, parentPrefix } from "@/lib/storage/s3";
import { CopyMoveDialog } from "./copy-move-dialog";
import { DeleteObjectsDialog } from "./delete-objects-dialog";
import { ObjectDetails } from "./object-details";
import { ObjectList } from "./object-list";
import { ObjectTextEditorDialog } from "./object-text-editor-dialog";
import { ObjectToolbar } from "./object-toolbar";
import { TextPromptDialog } from "./text-prompt-dialog";
import { TransferProgress } from "./transfer-progress";
import { UploadOptionsDialog } from "./upload-options-dialog";
import { useObjectActions } from "./use-object-actions";
import { type BrowserMode, type BrowserRow, useObjectListing } from "./use-object-listing";

export function ObjectBrowser({ bucket, active }: { bucket: string; active: boolean }) {
  const actions = useObjectActions(bucket);
  const [prefix, setPrefix] = useState("");
  const [showVersions, setShowVersions] = useState(false);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameRow, setRenameRow] = useState<BrowserRow | null>(null);
  const [copyMove, setCopyMove] = useState<{ rows: BrowserRow[]; move: boolean } | null>(null);
  const [deleteRows, setDeleteRows] = useState<BrowserRow[] | null>(null);
  const [uploadOptions, setUploadOptions] = useState(false);
  const [editRow, setEditRow] = useState<BrowserRow | null>(null);

  const mode: BrowserMode = search ? "search" : showVersions ? "versions" : "objects";
  const listing = useObjectListing(bucket, prefix, mode, search);
  const allRows = useMemo(
    () => listing.data?.pages.flatMap((page) => page.rows) ?? [],
    [listing.data],
  );
  const needle = filter.trim().toLowerCase();
  const rows = useMemo(
    () =>
      needle && mode !== "search"
        ? allRows.filter((row) => row.name.toLowerCase().includes(needle))
        : allRows,
    [allRows, needle, mode],
  );
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const details = rows.find((row) => row.id === detailsId && row.kind === "object") ?? null;
  const truncated = listing.data?.pages.at(-1)?.truncated ?? false;

  useEffect(() => {
    setSelected(new Set());
    setAnchor(null);
    setDetailsId(null);
  }, [prefix, mode, bucket]);

  useEffect(() => {
    if (!active || actions.readOnly) return;
    return setBucketDropHandler((paths) => void actions.upload(prefix, paths));
  }, [active, prefix, actions.readOnly, actions.upload]);

  function navigateTo(next: string) {
    setSearch("");
    setFilter("");
    setPrefix(next);
  }

  function select(
    row: BrowserRow,
    index: number,
    event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  ) {
    if (event.shiftKey && anchor !== null) {
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
      setSelected(new Set(rows.slice(from, to + 1).map((r) => r.id)));
    } else if (event.metaKey || event.ctrlKey) {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        return next;
      });
      setAnchor(index);
    } else {
      setSelected(new Set([row.id]));
      setAnchor(index);
    }
    setDetailsId(row.kind === "object" ? row.id : null);
  }

  function activate(row: BrowserRow) {
    if (row.kind === "folder") navigateTo(row.key);
    else setDetailsId(row.id);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      return;
    if (
      (event.key === "Delete" || (event.key === "Backspace" && event.metaKey)) &&
      selectedRows.length &&
      !actions.readOnly
    ) {
      event.preventDefault();
      setDeleteRows(selectedRows);
    } else if (event.key === "Backspace" && prefix && !search) {
      event.preventDefault();
      navigateTo(parentPrefix(prefix));
    } else if (event.key === "a" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      setSelected(new Set(rows.map((row) => row.id)));
    }
  }

  const rowActions = {
    open: activate,
    download: (targets: BrowserRow[]) => void actions.download(targets),
    rename: setRenameRow,
    copy: (targets: BrowserRow[]) => setCopyMove({ rows: targets, move: false }),
    move: (targets: BrowserRow[]) => setCopyMove({ rows: targets, move: true }),
    remove: setDeleteRows,
    edit: setEditRow,
    presign: (row: BrowserRow) => void actions.copyPresigned(row),
    openExternally: (row: BrowserRow) => void actions.openExternally(row),
  };

  return (
    <div className="flex h-full min-h-0" onKeyDown={onKeyDown}>
      <div className="flex min-w-0 flex-1 flex-col">
        <ObjectToolbar
          bucket={bucket}
          prefix={prefix}
          readOnly={actions.readOnly}
          filter={filter}
          search={search}
          showVersions={showVersions}
          selectedCount={selectedRows.length}
          fetching={listing.isFetching}
          onNavigate={navigateTo}
          onFilter={setFilter}
          onSearch={(value) => {
            setSearch(value);
            setFilter("");
          }}
          onShowVersions={setShowVersions}
          onRefresh={() => void listing.refetch()}
          onUploadFiles={() => void actions.pickAndUpload(prefix, false)}
          onUploadFolder={() => void actions.pickAndUpload(prefix, true)}
          onUploadOptions={() => setUploadOptions(true)}
          onNewFolder={() => setNewFolderOpen(true)}
          onDownload={() => void actions.download(selectedRows)}
          onCopy={() => setCopyMove({ rows: selectedRows, move: false })}
          onMove={() => setCopyMove({ rows: selectedRows, move: true })}
          onDelete={() => setDeleteRows(selectedRows)}
        />
        <div className="min-h-0 flex-1 overflow-auto" tabIndex={-1}>
          {listing.isLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Spinner /> Lade Objekte…
            </div>
          ) : listing.isError ? (
            <div className="p-4">
              <TableDataError
                title="Objekte konnten nicht geladen werden"
                error={listing.error instanceof Error ? listing.error.message : listing.error}
                onRetry={() => void listing.refetch()}
              />
            </div>
          ) : (
            <ObjectList
              bucket={bucket}
              rows={rows}
              mode={mode}
              selected={selected}
              readOnly={actions.readOnly}
              onSelect={select}
              onToggle={(row) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(row.id)) next.delete(row.id);
                  else next.add(row.id);
                  return next;
                })
              }
              onToggleAll={(checked) =>
                setSelected(checked ? new Set(rows.map((row) => row.id)) : new Set())
              }
              selectedRows={selectedRows}
              actions={rowActions}
            />
          )}
        </div>
        <footer className="flex shrink-0 items-center gap-3 border-t px-3 py-1.5 text-xs text-muted-foreground">
          <span>
            {rows.length} Einträge
            {selectedRows.length ? ` · ${selectedRows.length} ausgewählt` : ""}
            {mode === "search" && truncated ? " · Suche gekappt" : ""}
          </span>
          {listing.hasNextPage ? (
            <Button
              size="xs"
              variant="outline"
              disabled={listing.isFetchingNextPage}
              onClick={() => void listing.fetchNextPage()}
            >
              {listing.isFetchingNextPage ? <Spinner className="size-3" /> : null}
              Weitere laden
            </Button>
          ) : null}
          {!actions.readOnly && (
            <span className="hidden lg:inline">Dateien hierher ziehen zum Hochladen</span>
          )}
          <TransferProgress bucket={bucket} />
        </footer>
      </div>
      {details ? (
        <ObjectDetails
          key={details.id}
          bucket={bucket}
          row={details}
          readOnly={actions.readOnly}
          onClose={() => setDetailsId(null)}
          onEdit={() => setEditRow(details)}
          onDownload={() => void actions.download([details])}
        />
      ) : null}
      <TextPromptDialog
        open={newFolderOpen}
        title="Neuer Ordner"
        description={`Wird unter ${prefix || "/"} angelegt.`}
        label="Ordnername"
        placeholder="berichte/2026"
        confirmLabel="Anlegen"
        onOpenChange={setNewFolderOpen}
        onSubmit={async (name) => {
          await s3CreateFolder(actions.url, bucket, `${prefix}${name.trim().replace(/^\/+/, "")}`);
          await actions.refresh();
        }}
      />
      <TextPromptDialog
        open={renameRow !== null}
        title={renameRow?.kind === "folder" ? "Ordner umbenennen" : "Objekt umbenennen"}
        description="Voller Schlüssel. S3 kopiert dafür die Objekte und löscht die Originale."
        label="Neuer Schlüssel"
        initial={renameRow?.key ?? ""}
        confirmLabel="Umbenennen"
        onOpenChange={(open) => !open && setRenameRow(null)}
        onSubmit={async (value) => {
          if (!renameRow) return;
          const outcome = await s3RenameObject(actions.url, bucket, renameRow.key, value.trim());
          await actions.refresh();
          if (outcome.errors.length) throw new Error(outcome.errors.join("\n"));
          toast.success(`${basename(renameRow.key)} umbenannt`);
        }}
      />
      <CopyMoveDialog
        bucket={bucket}
        prefix={prefix}
        request={copyMove}
        onClose={() => setCopyMove(null)}
      />
      <DeleteObjectsDialog
        bucket={bucket}
        rows={deleteRows}
        versionsMode={mode === "versions"}
        onClose={() => setDeleteRows(null)}
        onDeleted={() => {
          setSelected(new Set());
          setDetailsId(null);
        }}
      />
      <UploadOptionsDialog
        open={uploadOptions}
        prefix={prefix}
        onOpenChange={setUploadOptions}
        onUpload={(directory, properties) =>
          void actions.pickAndUpload(prefix, directory, properties)
        }
      />
      <ObjectTextEditorDialog bucket={bucket} row={editRow} onClose={() => setEditRow(null)} />
    </div>
  );
}

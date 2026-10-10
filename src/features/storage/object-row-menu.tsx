import { CopyAsMenu } from "@/components/copy-as-menu";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import { copyWithToast } from "@/lib/clipboard";
import { formatMenuShortcut, MENU_KEYS } from "@/lib/hotkeys";
import { previewKind } from "@/lib/storage/s3";
import type { BrowserRow } from "./use-object-listing";

export interface RowActions {
  open: (row: BrowserRow) => void;
  download: (rows: BrowserRow[]) => void;
  rename: (row: BrowserRow) => void;
  copy: (rows: BrowserRow[]) => void;
  move: (rows: BrowserRow[]) => void;
  remove: (rows: BrowserRow[]) => void;
  edit: (row: BrowserRow) => void;
  presign: (row: BrowserRow) => void;
  openExternally: (row: BrowserRow) => void;
}

export function ObjectRowMenu({
  bucket,
  row,
  targets,
  readOnly,
  actions,
}: {
  bucket: string;
  row: BrowserRow;
  targets: BrowserRow[];
  readOnly: boolean;
  actions: RowActions;
}) {
  const isObject = row.kind === "object" && !row.deleteMarker;
  const editable =
    isObject && !row.versionId && ["text", "json", "csv"].includes(previewKind(row.key, null));
  const multi = targets.length > 1;
  return (
    <>
      {!multi && (
        <ContextMenuItem onSelect={() => actions.open(row)}>
          {row.kind === "folder" ? "Öffnen" : "Details"}
        </ContextMenuItem>
      )}
      {isObject && !multi && (
        <ContextMenuItem onSelect={() => actions.openExternally(row)}>
          Im Browser öffnen
        </ContextMenuItem>
      )}
      {(isObject || row.kind === "folder") && (
        <ContextMenuItem onSelect={() => actions.download(targets)}>
          Herunterladen{multi ? ` (${targets.length})` : ""}
        </ContextMenuItem>
      )}
      {!multi && (
        <>
          <ContextMenuSeparator />
          <CopyAsMenu name={row.name || row.key}>
            <ContextMenuItem onSelect={() => void copyWithToast(row.key, "Schlüssel")}>
              Schlüssel
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => void copyWithToast(`s3://${bucket}/${row.key}`, "S3-URI")}
            >
              S3-URI
            </ContextMenuItem>
            {isObject && (
              <ContextMenuItem onSelect={() => actions.presign(row)}>Presigned URL</ContextMenuItem>
            )}
          </CopyAsMenu>
        </>
      )}
      {!readOnly && (
        <>
          <ContextMenuSeparator />
          {editable && !multi && (
            <ContextMenuItem onSelect={() => actions.edit(row)}>Inhalt bearbeiten</ContextMenuItem>
          )}
          {!multi && !row.versionId && (
            <ContextMenuItem onSelect={() => actions.rename(row)}>Umbenennen…</ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => actions.copy(targets)}>Kopieren nach…</ContextMenuItem>
          {!row.versionId && (
            <ContextMenuItem onSelect={() => actions.move(targets)}>
              Verschieben nach…
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => actions.remove(targets)}>
            Löschen{multi ? ` (${targets.length})` : ""}…
            <ContextMenuShortcut>{formatMenuShortcut(MENU_KEYS.drop)}</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      )}
    </>
  );
}

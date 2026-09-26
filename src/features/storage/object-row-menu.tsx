import {
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderInputIcon,
  FolderOpenIcon,
  LinkIcon,
  PencilIcon,
  TextCursorInputIcon,
  TrashIcon,
} from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { copyText } from "@/lib/clipboard";
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
          <FolderOpenIcon /> {row.kind === "folder" ? "Öffnen" : "Details"}
        </ContextMenuItem>
      )}
      {(isObject || row.kind === "folder") && (
        <ContextMenuItem onSelect={() => actions.download(targets)}>
          <DownloadIcon /> Herunterladen{multi ? ` (${targets.length})` : ""}
        </ContextMenuItem>
      )}
      {isObject && !multi && (
        <>
          <ContextMenuItem onSelect={() => actions.presign(row)}>
            <LinkIcon /> Presigned URL kopieren
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => actions.openExternally(row)}>
            <ExternalLinkIcon /> Im Browser öffnen
          </ContextMenuItem>
        </>
      )}
      {!multi && (
        <>
          <ContextMenuItem onSelect={() => void copyText(row.key)}>
            <CopyIcon /> Schlüssel kopieren
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyText(`s3://${bucket}/${row.key}`)}>
            <CopyIcon /> S3-URI kopieren
          </ContextMenuItem>
        </>
      )}
      {!readOnly && (
        <>
          <ContextMenuSeparator />
          {editable && !multi && (
            <ContextMenuItem onSelect={() => actions.edit(row)}>
              <PencilIcon /> Inhalt bearbeiten
            </ContextMenuItem>
          )}
          {!multi && !row.versionId && (
            <ContextMenuItem onSelect={() => actions.rename(row)}>
              <TextCursorInputIcon /> Umbenennen
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => actions.copy(targets)}>
            <CopyIcon /> Kopieren nach…
          </ContextMenuItem>
          {!row.versionId && (
            <ContextMenuItem onSelect={() => actions.move(targets)}>
              <FolderInputIcon /> Verschieben nach…
            </ContextMenuItem>
          )}
          <ContextMenuItem variant="destructive" onSelect={() => actions.remove(targets)}>
            <TrashIcon /> Löschen{multi ? ` (${targets.length})` : ""}
          </ContextMenuItem>
        </>
      )}
    </>
  );
}

import {
  DownloadIcon,
  EyeIcon,
  HistoryIcon,
  LockIcon,
  PencilIcon,
  Share2Icon,
  SlidersHorizontalIcon,
  SquareTerminalIcon,
  TagIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/icon-button";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import { previewKind, selectFormat } from "@/lib/storage/s3";
import { DetailTabTrigger } from "./detail-tab-trigger";
import { ObjectLockPanel } from "./object-lock-panel";
import { ObjectPreview } from "./object-preview";
import { ObjectPropertiesPanel } from "./object-properties-panel";
import { ObjectSelectPanel } from "./object-select-panel";
import { ObjectVersionsPanel } from "./object-versions-panel";
import { PresignPanel } from "./presign-panel";
import { TagsEditor } from "./tags-editor";
import type { BrowserRow } from "./use-object-listing";

export function ObjectDetails({
  bucket,
  row,
  readOnly,
  onClose,
  onEdit,
  onDownload,
}: {
  bucket: string;
  row: BrowserRow;
  readOnly: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDownload: () => void;
}) {
  const [tab, setTab] = useState("preview");
  const versionId = row.versionId && row.versionId !== "null" ? row.versionId : null;
  const editable =
    !readOnly && !row.versionId && ["text", "json", "csv"].includes(previewKind(row.key, null));
  const canSelect = selectFormat(row.key) !== null;

  if (row.deleteMarker) {
    return (
      <aside className="flex w-[26rem] shrink-0 flex-col gap-2 border-l p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-medium">{row.name}</span>
          <IconButton
            size="icon-sm"
            variant="ghost"
            aria-label="Details schließen"
            onClick={onClose}
          >
            <XIcon />
          </IconButton>
        </div>
        <p className="text-muted-foreground">
          Delete-Marker (Version {row.versionId}). Löschen des Markers stellt die vorherige Version
          wieder her.
        </p>
      </aside>
    );
  }

  return (
    <aside className="flex w-[26rem] shrink-0 flex-col border-l" aria-label="Objektdetails">
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={row.key}>
            {row.name}
          </p>
          {versionId ? (
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              Version {versionId}
            </p>
          ) : null}
        </div>
        {editable && (
          <IconButton
            size="icon-sm"
            variant="ghost"
            aria-label="Inhalt bearbeiten"
            onClick={onEdit}
          >
            <PencilIcon />
          </IconButton>
        )}
        <IconButton size="icon-sm" variant="ghost" aria-label="Herunterladen" onClick={onDownload}>
          <DownloadIcon />
        </IconButton>
        <IconButton size="icon-sm" variant="ghost" aria-label="Details schließen" onClick={onClose}>
          <XIcon />
        </IconButton>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="mx-3 mt-2 flex w-auto">
          <DetailTabTrigger value="preview" label="Vorschau" icon={EyeIcon} />
          <DetailTabTrigger
            value="properties"
            label="Eigenschaften & Metadaten"
            icon={SlidersHorizontalIcon}
          />
          <DetailTabTrigger value="tags" label="Tags" icon={TagIcon} />
          <DetailTabTrigger value="versions" label="Versionen" icon={HistoryIcon} />
          <DetailTabTrigger value="lock" label="Sperre & Aufbewahrung" icon={LockIcon} />
          {canSelect && (
            <DetailTabTrigger value="select" label="S3 Select-Abfrage" icon={SquareTerminalIcon} />
          )}
          <DetailTabTrigger value="share" label="Teilen (Presigned URL)" icon={Share2Icon} />
        </TabsList>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <TabsContent value="preview" className="h-full">
            <ObjectPreview bucket={bucket} objectKey={row.key} versionId={versionId} />
          </TabsContent>
          <TabsContent value="properties">
            <ObjectPropertiesPanel
              bucket={bucket}
              objectKey={row.key}
              versionId={versionId}
              readOnly={readOnly || Boolean(row.versionId && !row.isLatest)}
            />
          </TabsContent>
          <TabsContent value="tags">
            <TagsEditor target={{ bucket, key: row.key, versionId }} readOnly={readOnly} />
          </TabsContent>
          <TabsContent value="versions">
            <ObjectVersionsPanel bucket={bucket} objectKey={row.key} readOnly={readOnly} />
          </TabsContent>
          <TabsContent value="lock">
            <ObjectLockPanel
              bucket={bucket}
              objectKey={row.key}
              versionId={versionId}
              readOnly={readOnly}
            />
          </TabsContent>
          {canSelect && (
            <TabsContent value="select">
              <ObjectSelectPanel bucket={bucket} objectKey={row.key} />
            </TabsContent>
          )}
          <TabsContent value="share">
            <PresignPanel bucket={bucket} row={row} readOnly={readOnly} />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}

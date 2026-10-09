import { GripVerticalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { memo, useState } from "react";
import { IconButton } from "@/components/icon-button";
import {
  BLOCK_LABEL,
  dashboardPages,
  useDashboardsStore,
  type WidgetBlock,
} from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { BlockEditor } from "./block-editor";
import { DividerBlock } from "./divider-block";
import { ImageBlock } from "./image-block";
import { LinkBlock } from "./link-block";
import { TextBlock } from "./text-block";

const NO_VARIABLES: never[] = [];

export const BlockCard = memo(function BlockCard({
  dashboardId,
  widgetId,
}: {
  dashboardId: string;
  widgetId: string;
}) {
  const [editing, setEditing] = useState(false);
  const widget = useDashboardsStore((s) =>
    s.dashboards.find((d) => d.id === dashboardId)?.widgets.find((w) => w.id === widgetId),
  );
  const locked = useDashboardsStore(
    (s) => s.dashboards.find((d) => d.id === dashboardId)?.locked ?? false,
  );
  const pages = useDashboardsStore((s) => s.dashboards.find((d) => d.id === dashboardId)?.pages);
  const variables = useDashboardsStore(
    (s) => s.dashboards.find((d) => d.id === dashboardId)?.variables ?? NO_VARIABLES,
  );
  const update = useDashboardsStore((s) => s.update);
  const block = widget?.block;
  if (!block) return null;
  const save = (next: WidgetBlock) =>
    update(dashboardId, (d) => ({
      widgets: d.widgets.map((w) => (w.id === widgetId ? { ...w, block: next } : w)),
    }));
  const card = block.variant === "card" && block.type === "text";
  const accent = block.variant === "accent" && block.type === "text";
  return (
    <div
      data-block-type={block.type}
      className={cn(
        "dashboard-block group/block relative h-full",
        card && "dashboard-widget rounded-lg border bg-card p-4 shadow-xs",
        accent &&
          "rounded-lg bg-[color-mix(in_oklab,var(--dash-accent)_12%,transparent)] p-4 [&_h1]:text-[var(--dash-accent)] [&_h2]:text-[var(--dash-accent)]",
        !locked &&
          !card &&
          !accent &&
          "rounded-md outline-1 outline-transparent outline-dashed hover:outline-border",
      )}
    >
      {block.type === "text" && <TextBlock block={block} />}
      {block.type === "image" && <ImageBlock block={block} />}
      {block.type === "link" && <LinkBlock block={block} />}
      {block.type === "divider" && <DividerBlock block={block} />}
      {!locked && (
        <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5 rounded-md border bg-popover/95 p-0.5 opacity-0 shadow-sm transition-opacity group-focus-within/block:opacity-100 group-hover/block:opacity-100">
          <GripVerticalIcon
            aria-label={`${BLOCK_LABEL[block.type]} verschieben`}
            className="widget-drag-handle size-3.5 cursor-grab text-muted-foreground active:cursor-grabbing"
          />
          <IconButton
            variant="ghost"
            size="icon-xs"
            aria-label={`${BLOCK_LABEL[block.type]} bearbeiten`}
            onClick={() => setEditing(true)}
          >
            <PencilIcon />
          </IconButton>
          <IconButton
            variant="ghost"
            size="icon-xs"
            aria-label={`${BLOCK_LABEL[block.type]} löschen`}
            onClick={() =>
              update(dashboardId, (d) => ({ widgets: d.widgets.filter((w) => w.id !== widgetId) }))
            }
          >
            <Trash2Icon />
          </IconButton>
        </div>
      )}
      {editing && (
        <BlockEditor
          block={block}
          pages={dashboardPages({ pages })}
          variables={variables}
          onSave={save}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
});

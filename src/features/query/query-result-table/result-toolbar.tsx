import { FilterIcon, FilterXIcon, Maximize2Icon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { TableActionsMenu } from "@/features/table/table-view/table-export-menu";
import { TimestampDisplayMenu } from "@/features/table/timestamp-display-menu";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useHasNewFeatures } from "@/lib/new-features";
import { describeResultCount } from "@/lib/result-grid";

interface ResultToolbarProps {
  timestampMenu: boolean;
  visibleCount: number;
  totalCount: number;
  filterCount: number;
  filterRowOpen: boolean;
  viewActive: boolean;
  onAutoSize: () => void;
  onContentSize: () => void;
  onToggleFilterRow: () => void;
  onReset: () => void;
}

export function ResultToolbar({
  timestampMenu,
  visibleCount,
  totalCount,
  filterCount,
  filterRowOpen,
  viewActive,
  onAutoSize,
  onContentSize,
  onToggleFilterRow,
  onReset,
}: ResultToolbarProps) {
  const timeNew = useHasNewFeatures("query.results.timestamps");
  const feature = useNewFeatureVisibility<HTMLButtonElement>("query.results.content-width");
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
      <span className="text-xs font-medium tabular-nums text-foreground">
        {describeResultCount(visibleCount, totalCount)}
      </span>
      <span className="text-xs text-muted-foreground">
        Sortierung und Filter gelten nur für die geladenen Zeilen (lokal, keine neue Abfrage).
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-1">
        {timestampMenu && (
          <TableActionsMenu isNew={timeNew}>
            <TimestampDisplayMenu />
          </TableActionsMenu>
        )}
        <Button
          ref={feature.ref}
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={onContentSize}
          title="Spaltenbreite an eine Stichprobe geladener Werte anpassen"
        >
          <Maximize2Icon className="size-3" />
          Inhaltsbreite{feature.isNew && <NewBadge />}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={onAutoSize}
          title="Alle Spaltenbreiten an die Header-Texte anpassen"
        >
          <Maximize2Icon className="size-3" />
          Headerbreite
        </Button>
        <Button
          size="sm"
          variant={filterRowOpen ? "secondary" : "ghost"}
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={onToggleFilterRow}
        >
          <FilterIcon className="size-3" />
          Filter
          {filterCount > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 font-mono text-[10px] text-primary">
              {filterCount}
            </span>
          )}
        </Button>
        {viewActive && (
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={onReset}>
            <FilterXIcon className="size-3" />
            Zurücksetzen
          </Button>
        )}
      </div>
    </div>
  );
}

import { Grid, type GridItem } from "l8grid";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BLOCK_LABEL,
  type Dashboard,
  type DashboardPage,
  dashboardPages,
  GRID_COLS,
  GRID_GAP,
  rowHeightFor,
  useDashboardsStore,
  type Widget,
  widgetMinSize,
  widgetsOnPage,
} from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { DashboardEmptyCanvas } from "./dashboard-empty-canvas";
import { DashboardGridCell } from "./dashboard-grid-cell";
import { useDashboardInteraction } from "./dashboard-interaction";

const EMPTY_WIDGETS: Widget[] = [];

export const DashboardCanvas = memo(function DashboardCanvas({
  dashboardId,
  pageId,
  onEdit,
  onAdd,
  onOpenCharts,
}: {
  dashboardId: string;
  pageId: string;
  onEdit?: (id: string) => void;
  onAdd?: () => void;
  onOpenCharts?: () => void;
}) {
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const allWidgets = useDashboardsStore(
    (s) => s.dashboards.find((d) => d.id === dashboardId)?.widgets ?? EMPTY_WIDGETS,
  );
  const pages = useDashboardsStore((s) => s.dashboards.find((d) => d.id === dashboardId)?.pages);
  const widgets = useMemo(() => {
    const list: DashboardPage[] = dashboardPages({ pages });
    return widgetsOnPage(allWidgets, list, pageId);
  }, [allWidgets, pages, pageId]);
  const presenting = useDashboardInteraction()?.presenting ?? false;
  const storedLock = useDashboardsStore(
    (s) => s.dashboards.find((d) => d.id === dashboardId)?.locked ?? false,
  );
  const locked = storedLock || presenting;
  const update = useDashboardsStore((s) => s.update);
  const { ref: gridHost, width } = useElementSize<HTMLDivElement>();
  const [measured, setMeasured] = useState(false);
  useEffect(() => {
    if (width > 0) setMeasured(true);
  }, [width]);
  const layout = useMemo<GridItem[]>(
    () =>
      widgets.map((w) => ({
        id: w.id,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        ...widgetMinSize(w),
      })),
    [widgets],
  );
  const labels = useRef(new Map<string, string>());
  useEffect(() => {
    labels.current = new Map(
      widgets.map((w) => [w.id, w.block ? BLOCK_LABEL[w.block.type] : w.title || w.id]),
    );
  }, [widgets]);
  const getItemLabel = useCallback((id: string) => labels.current.get(id) ?? id, []);

  const applyLayout = useCallback(
    (next: GridItem[]) =>
      update(dashboardId, (d: Dashboard) => ({
        widgets: d.widgets.map((w) => {
          const item = next.find((l) => l.id === w.id);
          return item && (item.x !== w.x || item.y !== w.y || item.w !== w.w || item.h !== w.h)
            ? { ...w, x: item.x, y: item.y, w: item.w, h: item.h }
            : w;
        }),
      })),
    [update, dashboardId],
  );

  const renderItem = useCallback(
    (id: string) =>
      scrollRoot && (
        <DashboardGridCell
          dashboardId={dashboardId}
          widgetId={id}
          scrollRoot={scrollRoot}
          onEdit={onEdit}
        />
      ),
    [scrollRoot, dashboardId, onEdit],
  );

  return (
    <div ref={setScrollRoot} className="dashboard-canvas relative min-h-0 flex-1 overflow-y-auto">
      <div ref={gridHost} className="relative min-h-full px-4 pt-4 pb-6">
        {measured && scrollRoot && widgets.length > 0 && (
          <Grid
            layout={layout}
            onLayoutChange={applyLayout}
            renderItem={renderItem}
            getItemLabel={getItemLabel}
            cols={GRID_COLS}
            rowHeight={rowHeightFor(width)}
            gap={GRID_GAP}
            draggable={!locked}
            resizable={!locked}
            handle
            className="dashboard-grid min-h-[60vh] [&_.l8-item]:[contain:layout_paint] [&_.l8-item]:[transition-property:transform]!"
          />
        )}
        {widgets.length === 0 && <DashboardEmptyCanvas onAdd={onAdd} onOpenCharts={onOpenCharts} />}
      </div>
    </div>
  );
});

import { memo, useState } from "react";
import GridLayout, { type Layout, useContainerWidth } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import {
  type Dashboard,
  GRID_COLS,
  GRID_GAP,
  minSize,
  rowHeightFor,
  useDashboardsStore,
  type Widget,
} from "@/lib/dashboards";
import { DashboardEmptyCanvas } from "./dashboard-empty-canvas";
import { WidgetCard } from "./widget-card";

const EMPTY_WIDGETS: Widget[] = [];

export const DashboardCanvas = memo(function DashboardCanvas({
  dashboardId,
  onEdit,
  onAdd,
  onOpenCharts,
}: {
  dashboardId: string;
  onEdit?: (id: string) => void;
  onAdd?: () => void;
  onOpenCharts?: () => void;
}) {
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const widgets = useDashboardsStore(
    (s) => s.dashboards.find((d) => d.id === dashboardId)?.widgets ?? EMPTY_WIDGETS,
  );
  const locked = useDashboardsStore(
    (s) => s.dashboards.find((d) => d.id === dashboardId)?.locked ?? false,
  );
  const update = useDashboardsStore((s) => s.update);
  const dashboard = { widgets, locked };
  const onChange = (patch: Partial<Dashboard> | ((d: Dashboard) => Partial<Dashboard>)) =>
    update(dashboardId, patch);
  const { width, containerRef, mounted } = useContainerWidth();
  const layout: Layout = dashboard.widgets.map((w) => ({
    i: w.id,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    ...minSize(w.chart),
    static: dashboard.locked,
  }));

  const applyLayout = (next: Layout) =>
    onChange((d) => ({
      widgets: d.widgets.map((w) => {
        const item = next.find((l) => l.i === w.id);
        return item && (item.x !== w.x || item.y !== w.y || item.w !== w.w || item.h !== w.h)
          ? { ...w, x: item.x, y: item.y, w: item.w, h: item.h }
          : w;
      }),
    }));

  return (
    <div
      ref={setScrollRoot}
      className="dashboard-canvas relative min-h-0 flex-1 overflow-y-auto"
      onMouseDownCapture={(event) => {
        if ((event.target as Element).closest(".widget-drag-handle, .react-resizable-handle"))
          event.preventDefault();
      }}
    >
      <div ref={containerRef} className="relative min-h-full px-4 pt-4 pb-6">
        {mounted && scrollRoot && widgets.length > 0 && (
          <GridLayout
            width={width}
            layout={layout}
            gridConfig={{
              cols: GRID_COLS,
              rowHeight: rowHeightFor(width),
              margin: [GRID_GAP, GRID_GAP],
              containerPadding: [0, 0],
            }}
            dragConfig={{
              enabled: !dashboard.locked,
              handle: ".widget-drag-handle",
              bounded: false,
            }}
            resizeConfig={{ enabled: !dashboard.locked, handles: ["se"] }}
            onDragStop={applyLayout}
            onResizeStop={applyLayout}
            className="dashboard-grid min-h-[60vh] [&_.react-grid-item]:[contain:layout_paint] [&_.react-grid-item.cssTransforms]:[transition-property:transform]!"
          >
            {widgets.map((w) => (
              <div
                key={w.id}
                data-widget-id={w.id}
                data-chart-type={w.chart}
                className="[&_.react-resizable-handle]:z-10"
              >
                <WidgetCard
                  dashboardId={dashboardId}
                  widgetId={w.id}
                  scrollRoot={scrollRoot}
                  onEdit={onEdit}
                />
              </div>
            ))}
          </GridLayout>
        )}
        {dashboard.widgets.length === 0 && (
          <DashboardEmptyCanvas onAdd={onAdd} onOpenCharts={onOpenCharts} />
        )}
      </div>
    </div>
  );
});

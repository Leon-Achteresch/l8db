import { LayoutDashboardIcon } from "lucide-react";
import { memo } from "react";
import GridLayout, { type Layout, type LayoutItem, useContainerWidth } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import {
  CHARTS,
  type ChartKind,
  createId,
  type Dashboard,
  GRID_COLS,
  GRID_GAP,
  minSize,
  rowHeightFor,
  useDashboardsStore,
  type Widget,
} from "@/lib/dashboards";
import { WidgetCard } from "./widget-card";

export const DRAG_MIME = "application/x-l8db-chart";
let dragging: ChartKind | null = null;
const EMPTY_WIDGETS: Widget[] = [];

export const DashboardCanvas = memo(function DashboardCanvas({
  dashboardId,
  selectedDatasetId,
  onEdit,
}: {
  dashboardId: string;
  selectedDatasetId: string | null;
  onEdit?: (id: string) => void;
}) {
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
        return item ? { ...w, x: item.x, y: item.y, w: item.w, h: item.h } : w;
      }),
    }));

  return (
    <div ref={containerRef} className="min-h-full p-4">
      {mounted && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{
            cols: GRID_COLS,
            rowHeight: rowHeightFor(width),
            margin: [GRID_GAP, GRID_GAP],
            containerPadding: [0, 0],
          }}
          dragConfig={{ enabled: !dashboard.locked, handle: ".widget-drag-handle", bounded: false }}
          resizeConfig={{ enabled: !dashboard.locked, handles: ["se"] }}
          dropConfig={{
            enabled: !dashboard.locked,
            defaultItem: { w: 4, h: 6 },
            onDragOver: () =>
              dragging ? { w: CHARTS[dragging].w, h: CHARTS[dragging].h } : { w: 4, h: 6 },
          }}
          onDragStop={applyLayout}
          onResizeStop={applyLayout}
          onDrop={(next: Layout, item: LayoutItem | undefined, e: Event) => {
            const kind = ((e as DragEvent).dataTransfer?.getData(DRAG_MIME) || dragging) as
              | ChartKind
              | "";
            dragging = null;
            if (!kind || !item) return;
            const size = CHARTS[kind];
            const widget: Widget = {
              id: createId(),
              chart: kind,
              datasetId: selectedDatasetId,
              title: "",
              period: "all",
              x: item.x,
              y: item.y,
              w: size.w,
              h: size.h,
            };
            onChange((d) => ({
              widgets: [
                ...d.widgets.map((w) => {
                  const l = next.find((x) => x.i === w.id);
                  return l ? { ...w, x: l.x, y: l.y, w: l.w, h: l.h } : w;
                }),
                widget,
              ],
            }));
          }}
          className="min-h-[60vh] [&_.react-grid-item]:will-change-transform [&_.react-grid-item]:[contain:layout_paint]"
        >
          {widgets.map((w) => (
            <div key={w.id} className="[&_.react-resizable-handle]:z-10">
              <WidgetCard
                dashboardId={dashboardId}
                widgetId={w.id}
                onEdit={onEdit ? () => onEdit(w.id) : undefined}
              />
            </div>
          ))}
        </GridLayout>
      )}
      {dashboard.widgets.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="max-w-sm rounded-2xl border border-dashed p-8 text-center">
            <LayoutDashboardIcon className="mx-auto mb-3 size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">Noch keine Charts</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Erstelle im Bereich Charts deine Visualisierungen. Hier kannst du sie anschließend
              anordnen.
            </p>
          </div>
        </div>
      )}
    </div>
  );
});

export function setPendingDrag(e: React.DragEvent, kind: ChartKind) {
  dragging = kind;
  e.dataTransfer.setData(DRAG_MIME, kind);
  e.dataTransfer.setData("text/plain", kind);
  e.dataTransfer.effectAllowed = "copy";
}

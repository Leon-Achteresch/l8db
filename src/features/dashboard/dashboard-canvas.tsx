import { LayoutDashboardIcon, PlusIcon } from "lucide-react";
import { memo } from "react";
import GridLayout, { type Layout, useContainerWidth } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { Button } from "@/components/ui/button";
import {
  type Dashboard,
  GRID_COLS,
  GRID_GAP,
  minSize,
  rowHeightFor,
  useDashboardsStore,
  type Widget,
} from "@/lib/dashboards";
import { WidgetCard } from "./widget-card";

const EMPTY_WIDGETS: Widget[] = [];

export const DashboardCanvas = memo(function DashboardCanvas({
  dashboardId,
  onEdit,
  onAdd,
}: {
  dashboardId: string;
  onEdit?: (id: string) => void;
  onAdd?: () => void;
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
    <div ref={containerRef} className="relative min-h-full p-4">
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
          onDragStop={applyLayout}
          onResizeStop={applyLayout}
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
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-4">
          <div className="pointer-events-auto max-w-md rounded-2xl border border-dashed bg-card/60 p-8 text-center">
            <LayoutDashboardIcon className="mx-auto mb-3 size-8 text-muted-foreground/60" />
            <p className="text-sm font-semibold">Noch ist hier leer</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Ein Chart beantwortet eine Frage an deine Daten, zum Beispiel „Wie viele
              Bestellungen gab es pro Monat?“
            </p>
            {onAdd && (
              <Button size="sm" className="mt-4" onClick={onAdd}>
                <PlusIcon /> Ersten Chart erstellen
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

import { memo, useRef } from "react";
import { CHARTS, useDashboardsStore } from "@/lib/dashboards";
import { useInView } from "@/lib/hooks/use-in-view";
import { useChartSlot } from "./use-chart-slot";
import { WidgetCardInner } from "./widget-card-inner";

const NEAR_VIEWPORT = "300% 0px";

export const WidgetCard = memo(function WidgetCard({
  dashboardId,
  widgetId,
  scrollRoot,
  preview = false,
  onEdit,
}: {
  dashboardId: string;
  widgetId: string;
  scrollRoot: Element | null;
  preview?: boolean;
  onEdit?: (widgetId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, scrollRoot, NEAR_VIEWPORT);
  const active = useChartSlot(near, ref, true);
  const widget = useDashboardsStore((s) =>
    s.dashboards.find((d) => d.id === dashboardId)?.widgets.find((w) => w.id === widgetId),
  );
  const dataset = useDashboardsStore((s) => {
    const d = s.dashboards.find((x) => x.id === dashboardId);
    const w = d?.widgets.find((x) => x.id === widgetId);
    return d?.datasets.find((x) => x.id === w?.datasetId) ?? null;
  });
  const refreshSec = useDashboardsStore(
    (s) => s.dashboards.find((d) => d.id === dashboardId)?.refreshSec ?? 0,
  );
  const locked = useDashboardsStore(
    (s) => s.dashboards.find((d) => d.id === dashboardId)?.locked ?? false,
  );
  const update = useDashboardsStore((s) => s.update);
  if (!widget) return null;
  return (
    <div ref={ref} className="h-full">
      {active ? (
        <WidgetCardInner
          onEdit={onEdit ? () => onEdit(widgetId) : undefined}
          widget={widget}
          dataset={dataset}
          refreshSec={refreshSec}
          locked={locked || preview}
          onChange={(patch) =>
            update(dashboardId, (d) => ({
              widgets: d.widgets.map((w) => (w.id === widgetId ? { ...w, ...patch } : w)),
            }))
          }
          onRemove={() =>
            update(dashboardId, (d) => ({
              widgets: d.widgets.filter((w) => w.id !== widgetId),
              datasets: d.datasets.filter(
                (dataset) =>
                  dataset.id !== widget.datasetId ||
                  d.widgets.some((w) => w.id !== widgetId && w.datasetId === dataset.id),
              ),
            }))
          }
        />
      ) : (
        <div className="h-full truncate rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-xs">
          {widget.title || dataset?.name || CHARTS[widget.chart].label}
        </div>
      )}
    </div>
  );
});

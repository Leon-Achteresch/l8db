import { memo } from "react";
import { createId, useDashboardsStore } from "@/lib/dashboards";
import { WidgetCardInner } from "./widget-card-inner";

export const WidgetCard = memo(function WidgetCard({
  dashboardId,
  widgetId,
  preview = false,
  onEdit,
}: {
  dashboardId: string;
  widgetId: string;
  preview?: boolean;
  onEdit?: () => void;
}) {
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
    <WidgetCardInner
      onEdit={onEdit}
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
        update(dashboardId, (d) => ({ widgets: d.widgets.filter((w) => w.id !== widgetId) }))
      }
      onDuplicate={() =>
        update(dashboardId, (d) => ({
          widgets: [...d.widgets, { ...widget, id: createId(), y: widget.y + widget.h }],
        }))
      }
      dashboardId={dashboardId}
    />
  );
});

import { memo } from "react";
import { useDashboardsStore } from "@/lib/dashboards";
import { BlockCard } from "./blocks/block-card";
import { WidgetCard } from "./widget-card";

export const DashboardGridCell = memo(function DashboardGridCell({
  dashboardId,
  widgetId,
  scrollRoot,
  onEdit,
}: {
  dashboardId: string;
  widgetId: string;
  scrollRoot: HTMLElement;
  onEdit?: (id: string) => void;
}) {
  const chart = useDashboardsStore(
    (s) =>
      s.dashboards.find((d) => d.id === dashboardId)?.widgets.find((w) => w.id === widgetId)?.chart,
  );
  const blockType = useDashboardsStore(
    (s) =>
      s.dashboards.find((d) => d.id === dashboardId)?.widgets.find((w) => w.id === widgetId)?.block
        ?.type,
  );
  return (
    <div
      data-widget-id={widgetId}
      data-chart-type={blockType ? undefined : chart}
      data-block-type={blockType}
      className="h-full"
    >
      {blockType ? (
        <BlockCard dashboardId={dashboardId} widgetId={widgetId} />
      ) : (
        <WidgetCard
          dashboardId={dashboardId}
          widgetId={widgetId}
          scrollRoot={scrollRoot}
          onEdit={onEdit}
        />
      )}
    </div>
  );
});

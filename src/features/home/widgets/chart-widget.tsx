import { useMemo } from "react";
import { WidgetCardInner } from "@/features/dashboard/widget-card-inner";
import { useDashboardsStore } from "@/lib/dashboards";
import { useActiveDatabase } from "@/lib/db-selection";
import type { HomeWidget } from "@/lib/home-layout";
import { WidgetPlaceholder } from "./widget-placeholder";

function noop() {}

export function ChartWidget({ widget }: { widget: HomeWidget }) {
  const database = useActiveDatabase();
  const dashboard = useDashboardsStore((state) =>
    state.dashboards.find((entry) => entry.id === widget.dashboardId),
  );
  const chart = dashboard?.widgets.find((entry) => entry.id === widget.chartId);
  const dataset = dashboard?.datasets.find((entry) => entry.id === chart?.datasetId) ?? null;
  const sized = useMemo(
    () => (chart ? { ...chart, w: widget.w, h: widget.h } : null),
    [chart, widget.w, widget.h],
  );

  if (!dashboard || !sized)
    return <WidgetPlaceholder>Dieser Chart existiert nicht mehr.</WidgetPlaceholder>;
  if (dashboard.database && dashboard.database !== database)
    return (
      <WidgetPlaceholder>
        Dieser Chart gehört zur Datenbank{" "}
        <span className="font-mono text-foreground">{dashboard.database}</span>.
      </WidgetPlaceholder>
    );
  return (
    <WidgetCardInner
      widget={sized}
      dataset={dataset}
      refreshSec={dashboard.refreshSec}
      locked
      onChange={noop}
      onRemove={noop}
    />
  );
}

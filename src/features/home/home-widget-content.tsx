import { lazy, Suspense } from "react";
import type { HomeWidget } from "@/lib/home-layout";
import { ErDiagramWidget } from "./widgets/er-diagram-widget";
import { MetricsWidget } from "./widgets/metrics-widget";
import { NoteWidget } from "./widgets/note-widget";
import { PerformanceWidget } from "./widgets/performance-widget";
import { QueryWidget } from "./widgets/query-widget";
import { RecentWidget } from "./widgets/recent-widget";
import { StorageWidget } from "./widgets/storage-widget";
import { TablesWidget } from "./widgets/tables-widget";

const ChartWidget = lazy(() =>
  import("./widgets/chart-widget").then(({ ChartWidget }) => ({ default: ChartWidget })),
);

export function HomeWidgetContent({
  widget,
  connectionId,
  onChange,
}: {
  widget: HomeWidget;
  connectionId: string;
  onChange: (patch: Partial<HomeWidget>) => void;
}) {
  switch (widget.kind) {
    case "metrics":
      return <MetricsWidget />;
    case "tables":
      return <TablesWidget />;
    case "recent":
      return <RecentWidget connectionId={connectionId} />;
    case "storage":
      return <StorageWidget connectionId={connectionId} />;
    case "er-diagram":
      return <ErDiagramWidget />;
    case "performance":
      return <PerformanceWidget connectionId={connectionId} />;
    case "chart":
      return (
        <Suspense fallback={null}>
          <ChartWidget widget={widget} />
        </Suspense>
      );
    case "query":
      return <QueryWidget widget={widget} onChange={onChange} />;
    case "note":
      return <NoteWidget widget={widget} onChange={onChange} />;
  }
}

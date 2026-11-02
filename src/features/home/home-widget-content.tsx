import { lazy, Suspense } from "react";
import type { HomeWidget } from "@/lib/home-layout";
import { NoteWidget } from "./widgets/note-widget";
import { PerformanceWidget } from "./widgets/performance-widget";
import { QueryWidget } from "./widgets/query-widget";

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

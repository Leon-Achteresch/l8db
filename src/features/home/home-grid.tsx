import GridLayout, { type Layout, useContainerWidth } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { PanelErrorBoundary } from "@/components/error-boundary/panel-error-boundary";
import {
  DEFAULT_HOME_LAYOUT,
  HOME_GRID_COLS,
  HOME_GRID_GAP,
  HOME_ROW_HEIGHT,
  HOME_STACK_WIDTH,
  HOME_WIDGETS,
  type HomeWidget,
  useHomeLayoutStore,
} from "@/lib/home-layout";
import { cn } from "@/lib/utils";
import { HomeWidgetContent } from "./home-widget-content";
import { HomeWidgetFrame } from "./home-widget-frame";

export function HomeGrid({ connectionId, editing }: { connectionId: string; editing: boolean }) {
  const widgets = useHomeLayoutStore((state) => state.layouts[connectionId] ?? DEFAULT_HOME_LAYOUT);
  const setLayout = useHomeLayoutStore((state) => state.setLayout);
  const { width, containerRef, mounted } = useContainerWidth();
  const stacked = width < HOME_STACK_WIDTH;
  const ordered = stacked ? [...widgets].sort((a, b) => a.y - b.y || a.x - b.x) : widgets;
  let offset = 0;
  const layout: Layout = ordered.map((widget) => {
    const { minW, minH } = HOME_WIDGETS[widget.kind];
    const item = {
      i: widget.id,
      x: stacked ? 0 : widget.x,
      y: stacked ? offset : widget.y,
      w: stacked ? HOME_GRID_COLS : widget.w,
      h: widget.h,
      minW,
      minH,
      static: !editing || stacked,
    };
    offset += widget.h;
    return item;
  });

  const applyLayout = (next: Layout) =>
    setLayout(connectionId, (current) =>
      current.map((widget) => {
        const item = next.find((entry) => entry.i === widget.id);
        return item ? { ...widget, x: item.x, y: item.y, w: item.w, h: item.h } : widget;
      }),
    );
  const patch = (id: string, change: Partial<HomeWidget>) =>
    setLayout(connectionId, (current) =>
      current.map((widget) => (widget.id === id ? { ...widget, ...change } : widget)),
    );
  const remove = (id: string) =>
    setLayout(connectionId, (current) => current.filter((widget) => widget.id !== id));

  return (
    <div ref={containerRef}>
      {mounted && widgets.length > 0 && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{
            cols: HOME_GRID_COLS,
            rowHeight: HOME_ROW_HEIGHT,
            margin: [HOME_GRID_GAP, HOME_GRID_GAP],
            containerPadding: [0, 0],
          }}
          dragConfig={{
            enabled: editing && !stacked,
            bounded: false,
            cancel: ".home-widget-control",
          }}
          resizeConfig={{ enabled: editing && !stacked, handles: ["se"] }}
          onDragStop={applyLayout}
          onResizeStop={applyLayout}
          className={cn(
            "[&_.react-grid-item]:[contain:layout_paint] [&_.react-grid-item.cssTransforms]:[transition-property:transform]!",
            editing && "[&_.react-grid-item]:select-none",
          )}
        >
          {ordered.map((widget) => (
            <div
              key={widget.id}
              data-home-widget={widget.id}
              className="[&_.react-resizable-handle]:z-10"
            >
              <HomeWidgetFrame
                label={HOME_WIDGETS[widget.kind].label}
                editing={editing}
                onRemove={() => remove(widget.id)}
              >
                <PanelErrorBoundary
                  label="Das Widget"
                  source="home-widget"
                  compact
                  resetKeys={[widget]}
                >
                  <HomeWidgetContent
                    widget={widget}
                    connectionId={connectionId}
                    onChange={(change) => patch(widget.id, change)}
                  />
                </PanelErrorBoundary>
              </HomeWidgetFrame>
            </div>
          ))}
        </GridLayout>
      )}
      {widgets.length === 0 && (
        <p className="rounded-2xl border border-dashed px-5 py-12 text-center text-sm text-muted-foreground">
          Über „Anpassen“ heftest du Abfrage-Ergebnisse, Dashboard-Charts, Notizen oder die
          Performance-Übersicht dieser Verbindung hier an.
        </p>
      )}
    </div>
  );
}

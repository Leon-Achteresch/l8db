import { type ComponentType, type LazyExoticComponent, lazy, Suspense } from "react";
import { PanelErrorBoundary } from "@/components/error-boundary/panel-error-boundary";
import type { DiscoverTab } from "@/features/discovery/discover-tabs";

const components = new Map<string, LazyExoticComponent<ComponentType>>();

export function DiscoverTabContent({ tab }: { tab: DiscoverTab }) {
  let Component = components.get(tab.id);
  if (!Component) {
    Component = lazy(tab.load);
    components.set(tab.id, Component);
  }
  return (
    <PanelErrorBoundary label={tab.label} source={`discover.${tab.id}`} resetKeys={[tab.id]}>
      <Suspense fallback={null}>
        <Component />
      </Suspense>
    </PanelErrorBoundary>
  );
}

import { type ComponentType, type LazyExoticComponent, lazy, Suspense } from "react";
import { PanelErrorBoundary } from "@/components/error-boundary/panel-error-boundary";
import type { DiscoveryHostEntry } from "@/features/discovery/registry";

const components = new Map<string, LazyExoticComponent<ComponentType>>();

export function DiscoverySubHost({ entry }: { entry: DiscoveryHostEntry }) {
  let Component = components.get(entry.id);
  if (!Component) {
    Component = lazy(entry.load);
    components.set(entry.id, Component);
  }
  return (
    <PanelErrorBoundary
      label={entry.id}
      source={`discovery.${entry.id}`}
      compact
      className="hidden"
    >
      <Suspense fallback={null}>
        <Component />
      </Suspense>
    </PanelErrorBoundary>
  );
}

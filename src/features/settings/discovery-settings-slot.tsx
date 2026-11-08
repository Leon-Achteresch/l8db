import { type ComponentType, type LazyExoticComponent, lazy, Suspense } from "react";
import { PanelErrorBoundary } from "@/components/error-boundary/panel-error-boundary";
import type { DiscoverySettingsSlot as Slot } from "@/features/settings/discovery-settings-slots";

const components = new Map<string, LazyExoticComponent<ComponentType>>();

export function DiscoverySettingsSlot({ slot }: { slot: Slot }) {
  let Component = components.get(slot.id);
  if (!Component) {
    Component = lazy(slot.load);
    components.set(slot.id, Component);
  }
  return (
    <PanelErrorBoundary label={slot.id} source={`discovery-settings.${slot.id}`} compact>
      <Suspense fallback={null}>
        <Component />
      </Suspense>
    </PanelErrorBoundary>
  );
}

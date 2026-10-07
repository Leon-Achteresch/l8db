import { useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useWorkbenchTabs } from "@/lib/workbench-tabs";

export function WorkbenchView({ tabId }: { tabId?: string } = {}) {
  const search = useSearch({ strict: false }) as { compareId?: string };
  const id = tabId ?? search.compareId;
  const entry = useWorkbenchTabs((state) => state.entries.find((item) => item.id === id));
  const container = entry?.container;
  const slot = useRef<HTMLDivElement>(null);
  const feature = useNewFeatureVisibility<HTMLDivElement>("workspace.inline-tabs");
  useEffect(() => {
    const target = slot.current;
    if (!container || !target) return;
    target.append(container);
    requestAnimationFrame(() => {
      const field = container.querySelector<HTMLElement>("input, textarea, button");
      field?.focus({ preventScroll: true });
    });
    return () => {
      container.remove();
    };
  }, [container]);
  return (
    <div ref={feature.ref} className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {feature.isNew && (
        <div className="absolute top-3 right-4 z-10">
          <NewBadge />
        </div>
      )}
      <div ref={slot} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!entry && (
          <p className="p-6 text-sm text-muted-foreground">
            Dieser Arbeitsbereich ist geschlossen. Öffne ihn erneut über die zugehörige Aktion.
          </p>
        )}
      </div>
    </div>
  );
}

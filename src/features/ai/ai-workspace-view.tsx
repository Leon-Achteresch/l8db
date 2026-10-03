import { useLayoutEffect } from "react";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function AiWorkspaceView() {
  useLayoutEffect(() => {
    window.dispatchEvent(new Event("ai-workspace-surface-ready"));
  }, []);
  const feature = useNewFeatureVisibility<HTMLDivElement>("ai.workspace");
  return (
    <div
      ref={feature.ref}
      id="ai-page-surface"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
    />
  );
}

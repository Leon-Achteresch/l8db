import { lazy, Suspense, useEffect, useState } from "react";
import { PanelErrorBoundary } from "@/components/error-boundary/panel-error-boundary";
import { useUpdatePrompt } from "@/lib/hooks/use-update-prompt";

const UpdateAvailableDialog = lazy(() =>
  import("./update-available-dialog").then((module) => ({
    default: module.UpdateAvailableDialog,
  })),
);

export function UpdateAvailableGate() {
  const { update } = useUpdatePrompt();
  const [offered, setOffered] = useState(false);
  useEffect(() => {
    if (update) setOffered(true);
  }, [update]);
  if (!update && !offered) return null;
  return (
    <PanelErrorBoundary label="Der Update-Dialog" source="update-dialog" compact>
      <Suspense fallback={null}>
        <UpdateAvailableDialog />
      </Suspense>
    </PanelErrorBoundary>
  );
}

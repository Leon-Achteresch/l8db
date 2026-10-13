import { lazy, Suspense } from "react";
import { useUpdatePrompt } from "@/lib/hooks/use-update-prompt";

const UpdateAvailableDialog = lazy(() =>
  import("./update-available-dialog").then((module) => ({
    default: module.UpdateAvailableDialog,
  })),
);

export function UpdateAvailableGate() {
  const { update } = useUpdatePrompt();
  if (!update) return null;
  return (
    <Suspense fallback={null}>
      <UpdateAvailableDialog />
    </Suspense>
  );
}

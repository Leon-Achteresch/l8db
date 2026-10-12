import { createFileRoute } from "@tanstack/react-router";
import { WorkbenchView } from "@/features/shell/workbench-view";

export const Route = createFileRoute("/_app/_workspace/workbench")({
  validateSearch: (search: Record<string, unknown>) => ({
    compareId: typeof search.compareId === "string" ? search.compareId : undefined,
  }),
  component: WorkbenchView,
});

import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceLayout } from "@/features/shell/workspace-layout";

export const Route = createFileRoute("/_app/_workspace")({
  component: WorkspaceLayout,
});

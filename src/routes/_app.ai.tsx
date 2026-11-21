import { createFileRoute, redirect } from "@tanstack/react-router";
import { AiWorkspaceView } from "@/features/ai/ai-workspace-view";
import { aiEnabled } from "@/lib/ai/access";

export const Route = createFileRoute("/_app/ai")({
  beforeLoad: () => {
    if (!aiEnabled()) throw redirect({ to: "/" });
  },
  component: AiWorkspaceView,
});

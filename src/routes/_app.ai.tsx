import { createFileRoute } from "@tanstack/react-router";
import { AiWorkspaceView } from "@/features/ai/ai-workspace-view";

export const Route = createFileRoute("/_app/ai")({ component: AiWorkspaceView });

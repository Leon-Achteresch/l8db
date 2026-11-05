import { createFileRoute } from "@tanstack/react-router";
import { WorkspacesView } from "@/features/workspaces/workspaces-view";

export const Route = createFileRoute("/workspaces")({ component: WorkspacesView });

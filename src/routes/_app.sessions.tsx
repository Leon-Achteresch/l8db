import { createFileRoute } from "@tanstack/react-router";

import { SessionsView } from "@/features/sessions/sessions-view";

export const Route = createFileRoute("/_app/sessions")({
  component: SessionsView,
});

import { createFileRoute } from "@tanstack/react-router";

import { MonitorView } from "@/features/monitor/monitor-view";

export const Route = createFileRoute("/_app/_workspace/monitor")({
  component: MonitorView,
});

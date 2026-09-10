import { createFileRoute } from "@tanstack/react-router";

import { TriggerView } from "@/features/triggers/trigger-view";

export const Route = createFileRoute("/_app/_workspace/triggers/$schema/$table/$trigger")({
  component: TriggerView,
});

import { createFileRoute } from "@tanstack/react-router";

import { TriggerPage } from "@/pages/TriggerPage";

export const Route = createFileRoute(
  "/_app/triggers/$schema/$table/$trigger",
)({
  component: TriggerPage,
});

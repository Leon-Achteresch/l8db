import { createFileRoute } from "@tanstack/react-router";

import { EnumsView } from "@/features/enums/enums-view";

export const Route = createFileRoute("/_app/_workspace/enums")({
  component: EnumsView,
});

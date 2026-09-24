import { createFileRoute } from "@tanstack/react-router";
import { DeferredOutlet } from "@/features/shell/deferred-outlet";

export const Route = createFileRoute("/_app/_workspace/query")({
  component: DeferredOutlet,
});

import { createFileRoute } from "@tanstack/react-router";

import { FunctionView } from "@/features/functions/function-view";

export const Route = createFileRoute("/_app/functions/$schema/$name")({
  component: FunctionView,
  validateSearch: (search: Record<string, unknown>): { oid?: string } => ({
    oid: typeof search["oid"] === "string" ? search["oid"] : undefined,
  }),
});

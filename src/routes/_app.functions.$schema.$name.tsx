import { createFileRoute } from "@tanstack/react-router";

import { FunctionPage } from "@/pages/FunctionPage";

export const Route = createFileRoute("/_app/functions/$schema/$name")({
  component: FunctionPage,
  validateSearch: (
    search: Record<string, unknown>,
  ): { oid: string } => ({
    oid: String(search["oid"] ?? ""),
  }),
});

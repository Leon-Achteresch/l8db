import { createFileRoute, redirect } from "@tanstack/react-router";

import { SchemaCompareView } from "@/features/schema-compare/schema-compare-view";

export const Route = createFileRoute("/_app/_workspace/schema-compare")({
  validateSearch: (search: Record<string, unknown>) => ({
    compareId: typeof search.compareId === "string" ? search.compareId : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (!search.compareId)
      throw redirect({
        to: "/schema-compare",
        search: { compareId: crypto.randomUUID() },
        replace: true,
      });
  },
  component: SchemaCompareView,
});

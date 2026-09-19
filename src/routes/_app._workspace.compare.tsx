import { createFileRoute, redirect } from "@tanstack/react-router";

import { CompareView } from "@/features/compare/compare-view";

export const Route = createFileRoute("/_app/_workspace/compare")({
  validateSearch: (search: Record<string, unknown>) => ({
    compareId: typeof search.compareId === "string" ? search.compareId : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (!search.compareId)
      throw redirect({ to: "/compare", search: { compareId: crypto.randomUUID() }, replace: true });
  },
  component: CompareView,
});

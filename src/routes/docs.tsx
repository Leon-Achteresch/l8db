import { createFileRoute } from "@tanstack/react-router";

import { DocsView } from "@/features/docs/docs-view";

interface DocsSearch {
  path?: string;
}

export const Route = createFileRoute("/docs")({
  validateSearch: (search: Record<string, unknown>): DocsSearch =>
    typeof search.path === "string" ? { path: search.path } : {},
  component: DocsView,
});

import { createFileRoute } from "@tanstack/react-router";

import { ErDiagramView } from "@/features/er-diagram/er-diagram-view";
import { type ErFocusDepth, parseErFocusDepth } from "@/lib/er-focus";

export const Route = createFileRoute("/_app/_workspace/er-diagram")({
  component: ErDiagramView,
  validateSearch: (
    search: Record<string, unknown>,
  ): { focusSchema?: string; focusTable?: string; depth?: ErFocusDepth } => {
    const focusSchema =
      typeof search["focusSchema"] === "string" ? search["focusSchema"] : undefined;
    const focusTable = typeof search["focusTable"] === "string" ? search["focusTable"] : undefined;
    if (!focusSchema || !focusTable) return {};
    return { focusSchema, focusTable, depth: parseErFocusDepth(search["depth"]) };
  },
});

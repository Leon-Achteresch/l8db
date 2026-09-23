import { createFileRoute } from "@tanstack/react-router";

import { SchemaCompareView } from "@/features/schema-compare/schema-compare-view";

export const Route = createFileRoute("/_app/_workspace/schema-compare")({
  component: SchemaCompareView,
});

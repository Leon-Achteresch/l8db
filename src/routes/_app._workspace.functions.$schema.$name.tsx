import { createFileRoute } from "@tanstack/react-router";

import { FunctionView } from "@/features/functions/function-view";

export const Route = createFileRoute("/_app/_workspace/functions/$schema/$name")({
  component: function FunctionRoute() {
    const { schema, name } = Route.useParams();
    const { oid, line } = Route.useSearch();
    return <FunctionView schema={schema} name={name} oid={oid} line={line} />;
  },
  validateSearch: (search: Record<string, unknown>): { oid?: string; line?: number } => ({
    oid: typeof search["oid"] === "string" ? search["oid"] : undefined,
    line: typeof search["line"] === "number" ? search["line"] : undefined,
  }),
});

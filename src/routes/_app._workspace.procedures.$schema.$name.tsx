import { createFileRoute } from "@tanstack/react-router";

import { ProcedureView } from "@/features/functions/procedure-view";

export const Route = createFileRoute("/_app/_workspace/procedures/$schema/$name")({
  component: function ProcedureRoute() {
    const { schema, name } = Route.useParams();
    const { oid, line } = Route.useSearch();
    return <ProcedureView schema={schema} name={name} oid={oid} line={line} />;
  },
  validateSearch: (search: Record<string, unknown>): { oid?: string; line?: number } => ({
    oid: typeof search["oid"] === "string" ? search["oid"] : undefined,
    line: typeof search["line"] === "number" ? search["line"] : undefined,
  }),
});

import { createFileRoute } from "@tanstack/react-router";

import { PackageView } from "@/features/functions/package-view";
import type { PackagePart } from "@/lib/plsql";

export const Route = createFileRoute("/_app/_workspace/packages/$schema/$name")({
  component: function PackageRoute() {
    const { schema, name } = Route.useParams();
    const { part, member } = Route.useSearch();
    return <PackageView schema={schema} name={name} part={part} member={member} />;
  },
  validateSearch: (search: Record<string, unknown>): { part?: PackagePart; member?: string } => ({
    part: search["part"] === "spec" || search["part"] === "body" ? search["part"] : undefined,
    member: typeof search["member"] === "string" ? search["member"] : undefined,
  }),
});

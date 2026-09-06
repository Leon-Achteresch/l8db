import { createFileRoute } from "@tanstack/react-router";

import { PackageView } from "@/features/functions/package-view";
import type { PackagePart } from "@/lib/plsql";

export const Route = createFileRoute("/_app/packages/$schema/$name")({
  component: PackageView,
  validateSearch: (search: Record<string, unknown>): { part?: PackagePart; member?: string } => ({
    part: search["part"] === "spec" || search["part"] === "body" ? search["part"] : undefined,
    member: typeof search["member"] === "string" ? search["member"] : undefined,
  }),
});

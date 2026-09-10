import { createFileRoute, redirect } from "@tanstack/react-router";

import { useTableTabs } from "@/lib/table-tabs";

export const Route = createFileRoute("/_app/query/")({
  beforeLoad: () => {
    const { tabs, openQueryTab } = useTableTabs.getState();
    const firstQuery = tabs.find((t) => t.kind === "query");
    if (firstQuery && firstQuery.kind === "query") {
      throw redirect({ to: "/query/$id", params: { id: firstQuery.id }, replace: true });
    }
    const id = openQueryTab();
    throw redirect({ to: "/query/$id", params: { id }, replace: true });
  },
  component: () => null,
});

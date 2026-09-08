import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";

export const Route = createFileRoute("/dev")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: import.meta.env.DEV
    ? lazyRouteComponent(() => import("@/features/dev/dev-view"), "DevView")
    : () => null,
});

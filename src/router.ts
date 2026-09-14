import { createRouter } from "@tanstack/react-router";
import { useConnectionsStore } from "@/lib/connections";
import { routeTree } from "./routeTree.gen";

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

useConnectionsStore.subscribe((state, previous) => {
  if (state.activeId === previous.activeId) return;
  const pathname = router.state.location.pathname;
  if (pathname === "/" || pathname.startsWith("/connections")) return;
  void router.navigate({ to: "/", replace: true });
});
